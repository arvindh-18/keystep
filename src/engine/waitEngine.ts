// Note-matching engine for Wait Mode and Play-along scoring.
// Pure logic: no DOM, no audio, no clocks of its own. Times are song seconds;
// `wall` timestamps (ms) are only used for the chord roll window.

import type { Note } from './timeline';

export type ChordPolicy = 'all' | 'any';

export interface MatchOptions {
  /** Onsets closer than this (seconds) form one chord group. */
  chordWindow: number;
  chordPolicy: ChordPolicy;
  /** All chord notes must arrive within this many ms (0 = no limit). */
  rollWindowMs: number;
  /** Accept the right pitch class in any octave. */
  octaveAgnostic: boolean;
  /** Song seconds before a group's onset when an early press is accepted. */
  earlyTolerance: number;
  /** Play-along only: seconds after onset before a note counts as missed. */
  lateTolerance: number;
  /** Play-along only: a press matching the next group skips (misses) the current one. */
  allowSkipAhead: boolean;
}

export const defaultMatchOptions: MatchOptions = {
  chordWindow: 0.03,
  chordPolicy: 'all',
  rollWindowMs: 0,
  octaveAgnostic: false,
  earlyTolerance: 0.25,
  lateTolerance: 0.25,
  allowSkipAhead: false,
};

export interface NoteGroup {
  index: number;
  time: number; // onset of earliest note in the group
  notes: Note[];
  pitches: number[]; // unique pitches required
  measure: number;
}

export type InputVerdict = 'hit' | 'wrong' | 'duplicate' | 'early-ignored';

export interface InputResult {
  verdict: InputVerdict;
  groupIndex: number; // group the input was matched against (-1 if none)
  groupCompleted: boolean;
  pitch: number;
}

export interface MatchEvents {
  onHit?(pitch: number, group: NoteGroup): void;
  onWrong?(pitch: number, group: NoteGroup | null, measure: number): void;
  onMissed?(note: Note, group: NoteGroup): void;
  onGroupComplete?(group: NoteGroup): void;
}

export function buildGroups(notes: Note[], chordWindow: number): NoteGroup[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: NoteGroup[] = [];
  let cur: Note[] = [];
  let anchor = -Infinity;
  const flush = () => {
    if (!cur.length) return;
    const pitches = [...new Set(cur.map((n) => n.pitch))].sort((a, b) => a - b);
    groups.push({ index: groups.length, time: cur[0].start, notes: cur, pitches, measure: cur[0].measure });
    cur = [];
  };
  for (const n of sorted) {
    if (n.start - anchor > chordWindow) { flush(); anchor = n.start; }
    cur.push(n);
  }
  flush();
  return groups;
}

/**
 * Tracks progress through note groups.
 * In wait mode the caller freezes playback at `nextBlockingTime()` until the group completes.
 * In play-along mode the caller calls `advanceTo(time)` every frame so late groups are marked missed.
 */
export class MatchEngine {
  groups: NoteGroup[] = [];
  /** Index of the group currently awaited. */
  cursor = 0;
  private hit = new Set<number>(); // pitches hit for the current group
  private hitWall: number[] = []; // wall times of hits (roll window)
  private completedFlags: boolean[] = [];

  constructor(public options: MatchOptions = { ...defaultMatchOptions }, public events: MatchEvents = {}) {}

  load(requiredNotes: Note[], fromTime = 0) {
    this.groups = buildGroups(requiredNotes, this.options.chordWindow);
    this.completedFlags = this.groups.map(() => false);
    this.seek(fromTime);
  }

  /** Reset progress so the first group at or after `time` is awaited. */
  seek(time: number) {
    let i = 0;
    while (i < this.groups.length && this.groups[i].time < time - 1e-4) i++;
    this.cursor = i;
    for (let k = i; k < this.completedFlags.length; k++) this.completedFlags[k] = false;
    this.resetGroupProgress();
  }

  get current(): NoteGroup | null {
    return this.groups[this.cursor] ?? null;
  }

  get finished(): boolean {
    return this.cursor >= this.groups.length;
  }

  /** Pitches of the current group that are still required. */
  pendingPitches(): number[] {
    const g = this.current;
    if (!g) return [];
    if (this.options.chordPolicy === 'any' && this.hit.size > 0) return [];
    return g.pitches.filter((p) => !this.hit.has(p));
  }

  hitPitches(): number[] {
    return [...this.hit];
  }

  /** Song time at which wait mode must hold playback (onset of the awaited group). */
  nextBlockingTime(): number | null {
    return this.current ? this.current.time : null;
  }

  private resetGroupProgress() {
    this.hit.clear();
    this.hitWall = [];
  }

  private matches(required: number, played: number) {
    return this.options.octaveAgnostic ? required % 12 === played % 12 : required === played;
  }

  /**
   * Feed a note-on. `songTime` is the song position at which it was played
   * (already latency-compensated), `wallMs` a monotonic wall clock.
   */
  noteOn(pitch: number, songTime: number, wallMs: number): InputResult {
    const g = this.current;
    if (!g) {
      this.events.onWrong?.(pitch, null, -1);
      return { verdict: 'wrong', groupIndex: -1, groupCompleted: false, pitch };
    }
    // Pressing far ahead of the next group: not an attempt at it.
    if (songTime < g.time - this.options.earlyTolerance) {
      const isPlausible = g.pitches.some((p) => this.matches(p, pitch));
      if (!isPlausible) this.events.onWrong?.(pitch, g, g.measure);
      return { verdict: isPlausible ? 'early-ignored' : 'wrong', groupIndex: g.index, groupCompleted: false, pitch };
    }
    const target = g.pitches.find((p) => this.matches(p, pitch) && !this.hit.has(p));
    if (target === undefined) {
      const already = g.pitches.some((p) => this.matches(p, pitch));
      if (already) return { verdict: 'duplicate', groupIndex: g.index, groupCompleted: false, pitch };
      // Play-along: the player moved on to the next chord; count this one as missed.
      const next = this.groups[this.cursor + 1];
      if (this.options.allowSkipAhead && next && songTime >= next.time - this.options.earlyTolerance && next.pitches.some((p) => this.matches(p, pitch))) {
        this.skipCurrent();
        return this.noteOn(pitch, songTime, wallMs);
      }
      this.events.onWrong?.(pitch, g, g.measure);
      return { verdict: 'wrong', groupIndex: g.index, groupCompleted: false, pitch };
    }
    // Roll window: forget hits that are too old to count as one chord.
    if (this.options.rollWindowMs > 0 && this.hitWall.length) {
      const first = this.hitWall[0];
      if (wallMs - first > this.options.rollWindowMs) this.resetGroupProgress();
    }
    this.hit.add(target);
    this.hitWall.push(wallMs);
    this.events.onHit?.(target, g);
    const done = this.options.chordPolicy === 'any' || g.pitches.every((p) => this.hit.has(p));
    if (done) this.completeCurrent();
    return { verdict: 'hit', groupIndex: g.index, groupCompleted: done, pitch };
  }

  private completeCurrent() {
    const g = this.current;
    if (!g) return;
    this.completedFlags[g.index] = true;
    this.events.onGroupComplete?.(g);
    this.cursor++;
    this.resetGroupProgress();
  }

  /** Skip the current group without playing it (counts its unplayed notes as missed). */
  skipCurrent() {
    const g = this.current;
    if (!g) return;
    for (const n of g.notes) if (!this.hit.has(n.pitch)) this.events.onMissed?.(n, g);
    this.cursor++;
    this.resetGroupProgress();
  }

  /** Step back one group (undo). */
  stepBack() {
    if (this.cursor > 0) this.cursor--;
    this.completedFlags[this.cursor] = false;
    this.resetGroupProgress();
  }

  /** Play-along: mark groups whose window has passed as missed. */
  advanceTo(songTime: number) {
    while (this.current && songTime > this.current.time + this.options.lateTolerance) {
      this.skipCurrent();
    }
  }
}
