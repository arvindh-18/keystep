// Converts a parsed MIDI file into a playable, time-accurate Song model:
// tempo map, measure grid, paired notes, sustain periods and track metadata.

import type { MidiFileData, RawEvent } from './midiParser';
import { programName } from './gm';

export type Hand = 'right' | 'left';
export type TrackRole = 'right' | 'left' | 'split' | 'accompany' | 'mute';

export interface Note {
  id: number;
  pitch: number;
  velocity: number;
  start: number; // seconds
  end: number; // seconds (key release)
  soundEnd: number; // seconds, extended by sustain pedal
  startTick: number;
  endTick: number;
  track: number;
  channel: number;
  measure: number; // 0-based measure index of the onset
}

export interface TrackInfo {
  index: number;
  name: string;
  channel: number;
  program: number;
  instrument: string;
  isDrum: boolean;
  noteCount: number;
  minPitch: number;
  maxPitch: number;
  avgPitch: number;
  defaultRole: TrackRole;
}

export interface TempoPoint { tick: number; time: number; microsecondsPerBeat: number; bpm: number }
export interface TimeSigPoint { tick: number; time: number; numerator: number; denominator: number }

export interface Measure {
  index: number;
  startTick: number;
  start: number; // seconds
  end: number;
  numerator: number;
  denominator: number;
  beatTimes: number[]; // seconds of each beat onset in the measure
}

export interface SustainSpan { channel: number; track: number; start: number; end: number }

export interface Song {
  title: string;
  format: number;
  ticksPerBeat: number;
  duration: number;
  tempos: TempoPoint[];
  timeSignatures: TimeSigPoint[];
  keySignature?: { key: number; scale: number };
  measures: Measure[];
  notes: Note[]; // sorted by start, then pitch
  tracks: TrackInfo[];
  sustain: SustainSpan[];
  totalTicks: number;
}

/** Tick <-> seconds conversion that honours every tempo change. */
export class TempoMap {
  readonly points: TempoPoint[];
  constructor(private ticksPerBeat: number, tempoEvents: { tick: number; microsecondsPerBeat: number }[], smpte?: { framesPerSecond: number; ticksPerFrame: number }) {
    const sorted = [...tempoEvents].sort((a, b) => a.tick - b.tick);
    const pts: TempoPoint[] = [];
    if (smpte) {
      // Fixed ticks-per-second timing: emulate with a constant "tempo".
      const ticksPerSecond = smpte.framesPerSecond * smpte.ticksPerFrame;
      const uspb = (ticksPerBeat / ticksPerSecond) * 1e6;
      pts.push({ tick: 0, time: 0, microsecondsPerBeat: uspb, bpm: 6e7 / uspb });
    } else {
      let cur = { tick: 0, time: 0, microsecondsPerBeat: 500000 };
      if (!sorted.length || sorted[0].tick > 0) pts.push({ ...cur, bpm: 120 });
      for (const ev of sorted) {
        if (ev.microsecondsPerBeat <= 0) continue;
        const time = cur.time + ((ev.tick - cur.tick) * cur.microsecondsPerBeat) / (1e6 * ticksPerBeat);
        cur = { tick: ev.tick, time, microsecondsPerBeat: ev.microsecondsPerBeat };
        const p = { ...cur, bpm: 6e7 / ev.microsecondsPerBeat };
        if (pts.length && pts[pts.length - 1].tick === ev.tick) pts[pts.length - 1] = p;
        else pts.push(p);
      }
    }
    this.points = pts;
  }

  private segmentForTick(tick: number): TempoPoint {
    const p = this.points;
    let lo = 0, hi = p.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    return p[lo];
  }

  tickToTime(tick: number): number {
    const s = this.segmentForTick(tick);
    return s.time + ((tick - s.tick) * s.microsecondsPerBeat) / (1e6 * this.ticksPerBeat);
  }

  timeToTick(time: number): number {
    const p = this.points;
    let lo = 0, hi = p.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid].time <= time) lo = mid; else hi = mid - 1;
    }
    const s = p[lo];
    return s.tick + ((time - s.time) * 1e6 * this.ticksPerBeat) / s.microsecondsPerBeat;
  }

  bpmAt(time: number): number {
    const p = this.points;
    let res = p[0];
    for (const pt of p) { if (pt.time <= time + 1e-9) res = pt; else break; }
    return res.bpm;
  }
}

interface OpenNote { tick: number; velocity: number }

export function buildSong(data: MidiFileData, title = 'Untitled'): Song {
  const tempoEvents: { tick: number; microsecondsPerBeat: number }[] = [];
  const timeSigEvents: { tick: number; numerator: number; denominator: number }[] = [];
  let keySignature: Song['keySignature'];
  let totalTicks = 0;

  for (const t of data.tracks) for (const e of t.events) {
    totalTicks = Math.max(totalTicks, e.tick);
    if (e.kind === 'tempo') tempoEvents.push(e);
    else if (e.kind === 'timeSignature' && e.numerator > 0 && e.denominator > 0) timeSigEvents.push(e);
    else if (e.kind === 'keySignature' && !keySignature) keySignature = { key: e.key, scale: e.scale };
  }

  const tempoMap = new TempoMap(data.ticksPerBeat, tempoEvents, data.smpte);

  // ---- Notes, split into logical tracks (file track × channel) ----
  interface Builder { fileTrack: number; channel: number; name: string; program: number; notes: Omit<Note, 'id' | 'track' | 'measure' | 'soundEnd'>[] }
  const builders = new Map<string, Builder>();
  const sustainRaw: { channel: number; fileTrack: number; tick: number; on: boolean }[] = [];
  const fileTrackNames: string[] = [];

  data.tracks.forEach((track, ti) => {
    const programs = new Map<number, number>();
    const open = new Map<number, OpenNote[]>(); // key: channel*128+pitch
    let name = '';
    let instrumentName = '';
    const getBuilder = (channel: number) => {
      const key = `${ti}:${channel}`;
      let b = builders.get(key);
      if (!b) { b = { fileTrack: ti, channel, name: '', program: programs.get(channel) ?? 0, notes: [] }; builders.set(key, b); }
      return b;
    };
    const close = (ev: { tick: number; channel: number; note: number }) => {
      const k = ev.channel * 128 + ev.note;
      const stack = open.get(k);
      if (!stack || !stack.length) return;
      const on = stack.shift()!;
      const end = Math.max(ev.tick, on.tick + 1);
      getBuilder(ev.channel).notes.push({
        pitch: ev.note, velocity: on.velocity, startTick: on.tick, endTick: end,
        start: tempoMap.tickToTime(on.tick), end: tempoMap.tickToTime(end), channel: ev.channel,
      });
    };
    const events = [...track.events].sort((a, b) => a.tick - b.tick || order(a) - order(b));
    for (const e of events) {
      switch (e.kind) {
        case 'trackName': if (!name) name = e.text; break;
        case 'instrumentName': if (!instrumentName) instrumentName = e.text; break;
        case 'program': programs.set(e.channel, e.program); { const b = builders.get(`${ti}:${e.channel}`); if (b && !b.notes.length) b.program = e.program; } break;
        case 'noteOn': {
          const k = e.channel * 128 + e.note;
          const stack = open.get(k) ?? [];
          // A re-strike while the same key is still open ends the previous note.
          if (stack.length) close({ tick: e.tick, channel: e.channel, note: e.note });
          const s2 = open.get(k) ?? [];
          s2.push({ tick: e.tick, velocity: e.velocity });
          open.set(k, s2);
          getBuilder(e.channel);
          break;
        }
        case 'noteOff': close(e); break;
        case 'controller':
          if (e.controller === 64) sustainRaw.push({ channel: e.channel, fileTrack: ti, tick: e.tick, on: e.value >= 64 });
          break;
        default: break;
      }
    }
    // Close dangling notes at the end of the track.
    for (const [k, stack] of open) for (const on of stack) {
      const channel = Math.floor(k / 128), note = k % 128;
      const end = Math.max(totalTicks, on.tick + data.ticksPerBeat);
      getBuilder(channel).notes.push({ pitch: note, velocity: on.velocity, startTick: on.tick, endTick: end, start: tempoMap.tickToTime(on.tick), end: tempoMap.tickToTime(end), channel });
    }
    fileTrackNames[ti] = name || instrumentName;
  });

  const usable = [...builders.values()].filter((b) => b.notes.length > 0);
  usable.sort((a, b) => a.fileTrack - b.fileTrack || a.channel - b.channel);
  const perFileTrackCount = new Map<number, number>();
  for (const b of usable) perFileTrackCount.set(b.fileTrack, (perFileTrackCount.get(b.fileTrack) ?? 0) + 1);

  const tracks: TrackInfo[] = usable.map((b, index) => {
    const pitches = b.notes.map((n) => n.pitch);
    const isDrum = b.channel === 9;
    const baseName = fileTrackNames[b.fileTrack];
    let name = baseName || (isDrum ? 'Drums' : programName(b.program));
    if ((perFileTrackCount.get(b.fileTrack) ?? 0) > 1) name = `${name} · ch ${b.channel + 1}`;
    return {
      index, name, channel: b.channel, program: b.program, instrument: isDrum ? 'Drum kit' : programName(b.program), isDrum,
      noteCount: b.notes.length,
      minPitch: Math.min(...pitches), maxPitch: Math.max(...pitches),
      avgPitch: pitches.reduce((s, p) => s + p, 0) / pitches.length,
      defaultRole: 'accompany',
    };
  });
  assignDefaultRoles(tracks);

  // ---- Measures from time signatures ----
  const sigs = [...timeSigEvents].sort((a, b) => a.tick - b.tick);
  if (!sigs.length || sigs[0].tick > 0) sigs.unshift({ tick: 0, numerator: 4, denominator: 4 });
  const measures: Measure[] = [];
  const lastTick = Math.max(totalTicks, 1);
  let tick = 0, sigIdx = 0;
  while (tick < lastTick && measures.length < 20000) {
    while (sigIdx + 1 < sigs.length && sigs[sigIdx + 1].tick <= tick) sigIdx++;
    const sig = sigs[sigIdx];
    const beatTicks = (data.ticksPerBeat * 4) / sig.denominator;
    let len = beatTicks * sig.numerator;
    // A signature change mid-measure starts a new measure there.
    const next = sigs[sigIdx + 1];
    if (next && next.tick > tick && next.tick < tick + len) len = next.tick - tick;
    const beatTimes: number[] = [];
    for (let bt = 0; bt < len - 1e-6; bt += beatTicks) beatTimes.push(tempoMap.tickToTime(tick + bt));
    measures.push({ index: measures.length, startTick: tick, start: tempoMap.tickToTime(tick), end: tempoMap.tickToTime(tick + len), numerator: sig.numerator, denominator: sig.denominator, beatTimes });
    tick += len;
  }
  if (!measures.length) measures.push({ index: 0, startTick: 0, start: 0, end: 2, numerator: 4, denominator: 4, beatTimes: [0, 0.5, 1, 1.5] });

  // ---- Sustain spans ----
  const sustain: SustainSpan[] = [];
  const builderTrackIndex = new Map<string, number>();
  usable.forEach((b, i) => builderTrackIndex.set(`${b.fileTrack}:${b.channel}`, i));
  const pedalGroups = new Map<string, { tick: number; on: boolean }[]>();
  for (const s of sustainRaw) {
    const k = `${s.fileTrack}:${s.channel}`;
    const arr = pedalGroups.get(k) ?? [];
    arr.push(s);
    pedalGroups.set(k, arr);
  }
  for (const [k, arr] of pedalGroups) {
    arr.sort((a, b) => a.tick - b.tick);
    let downAt = -1;
    const [ft, ch] = k.split(':').map(Number);
    // Pedal on a controller-only track applies to notes on the same channel anywhere.
    const trackIdx = builderTrackIndex.get(k) ?? usable.findIndex((b) => b.channel === ch);
    for (const ev of arr) {
      if (ev.on && downAt < 0) downAt = ev.tick;
      else if (!ev.on && downAt >= 0) {
        sustain.push({ channel: ch, track: trackIdx, start: tempoMap.tickToTime(downAt), end: tempoMap.tickToTime(ev.tick) });
        downAt = -1;
      }
    }
    if (downAt >= 0) sustain.push({ channel: ch, track: trackIdx, start: tempoMap.tickToTime(downAt), end: tempoMap.tickToTime(lastTick) });
    void ft;
  }
  sustain.sort((a, b) => a.start - b.start);

  // ---- Final note list ----
  const notes: Note[] = [];
  usable.forEach((b, ti) => {
    for (const n of b.notes) notes.push({ ...n, id: 0, track: ti, measure: 0, soundEnd: n.end });
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const pedalsByChannel = new Map<number, SustainSpan[]>();
  for (const s of sustain) {
    const arr = pedalsByChannel.get(s.channel) ?? [];
    arr.push(s);
    pedalsByChannel.set(s.channel, arr);
  }
  let mi = 0;
  notes.forEach((n, i) => {
    n.id = i;
    // Notes are sorted by start, so the measure pointer only moves forward.
    while (mi + 1 < measures.length && measures[mi + 1].start <= n.start + 1e-6) mi++;
    n.measure = mi;
    const spans = pedalsByChannel.get(n.channel);
    if (spans) {
      // Last pedal span starting at or before the key release.
      let lo = 0, hi = spans.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (spans[mid].start <= n.end + 1e-6) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (found >= 0 && spans[found].end > n.end) n.soundEnd = spans[found].end;
    }
  });

  const duration = Math.max(
    notes.reduce((m, n) => Math.max(m, n.end), 0),
    tempoMap.tickToTime(totalTicks),
    0.5,
  );

  return {
    title, format: data.format, ticksPerBeat: data.ticksPerBeat, duration,
    tempos: tempoMap.points,
    timeSignatures: sigs.map((s) => ({ ...s, time: tempoMap.tickToTime(s.tick) })),
    keySignature, measures: measures.filter((m) => m.start < duration + 1e-6 || m.index === 0),
    notes, tracks, sustain, totalTicks,
  };
}

function order(e: RawEvent): number {
  // At the same tick, process note-offs before note-ons so repeated notes pair correctly.
  if (e.kind === 'noteOff') return 0;
  if (e.kind === 'noteOn') return 2;
  return 1;
}

function assignDefaultRoles(tracks: TrackInfo[]) {
  const melodic = tracks.filter((t) => !t.isDrum);
  const pianoLike = (t: TrackInfo) => t.program <= 7;
  const byName = (t: TrackInfo): TrackRole | null => {
    const n = t.name.toLowerCase();
    if (/\b(right|rh|r\.h\.|treble|melody|upper)\b/.test(n) || /piano\s*r\b|\bright hand/.test(n)) return 'right';
    if (/\b(left|lh|l\.h\.|bass|lower)\b/.test(n) || /piano\s*l\b|\bleft hand/.test(n)) return 'left';
    return null;
  };
  for (const t of tracks) t.defaultRole = t.isDrum ? 'mute' : 'accompany';
  if (melodic.length === 1) { melodic[0].defaultRole = 'split'; return; }
  const named = melodic.map((t) => ({ t, r: byName(t) })).filter((x) => x.r);
  if (named.some((x) => x.r === 'right') && named.some((x) => x.r === 'left')) {
    for (const x of named) x.t.defaultRole = x.r!;
    return;
  }
  const pianos = melodic.filter(pianoLike);
  const pool = pianos.length >= 2 ? pianos : melodic;
  if (pool.length >= 2) {
    // Two busiest piano-ish tracks: higher one is right hand.
    const top2 = [...pool].sort((a, b) => b.noteCount - a.noteCount).slice(0, 2).sort((a, b) => b.avgPitch - a.avgPitch);
    top2[0].defaultRole = 'right';
    top2[1].defaultRole = 'left';
  } else if (pool.length === 1) {
    pool[0].defaultRole = 'split';
  }
}

/** Measure index containing time t. */
export function measureAt(song: Song, t: number): number {
  const m = song.measures;
  let lo = 0, hi = m.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m[mid].start <= t + 1e-9) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Hand assigned to a note given track roles and a split point (for 'split' tracks). */
export function handOf(note: Note, roles: TrackRole[], splitPoint = 60): Hand | null {
  const role = roles[note.track];
  if (role === 'right' || role === 'left') return role;
  if (role === 'split') return note.pitch >= splitPoint ? 'right' : 'left';
  return null;
}
