// Records what the player performs (notes, velocity, sustain pedal) with
// millisecond timestamps, and converts takes to notes / MIDI files.

import { writeMidi } from './midiWriter';

export type RecEvent =
  | { t: number; type: 'on'; note: number; vel: number }
  | { t: number; type: 'off'; note: number }
  | { t: number; type: 'pedal'; down: boolean };

export interface Take {
  id: string;
  name: string;
  date: number;
  duration: number; // seconds
  events: RecEvent[];
  songId?: string | null;
  songName?: string;
  noteCount: number;
}

export interface TakeNote { pitch: number; velocity: number; start: number; end: number; soundEnd: number }

export class Recorder {
  recording = false;
  private startPerf = 0;
  private events: RecEvent[] = [];
  private held = new Set<number>();
  private pedal = false;

  get elapsed(): number { return this.recording ? (performance.now() - this.startPerf) / 1000 : 0; }
  get noteCount(): number { return this.events.filter((e) => e.type === 'on').length; }

  start() {
    this.recording = true;
    this.startPerf = performance.now();
    this.events = [];
    this.held.clear();
    this.pedal = false;
  }

  private time(perf: number) { return Math.max(0, (perf - this.startPerf) / 1000); }

  noteOn(note: number, vel: number, perf = performance.now()) {
    if (!this.recording) return;
    this.events.push({ t: this.time(perf), type: 'on', note, vel });
    this.held.add(note);
  }

  noteOff(note: number, perf = performance.now()) {
    if (!this.recording || !this.held.has(note)) return;
    this.events.push({ t: this.time(perf), type: 'off', note });
    this.held.delete(note);
  }

  setPedal(down: boolean, perf = performance.now()) {
    if (!this.recording || down === this.pedal) return;
    this.pedal = down;
    this.events.push({ t: this.time(perf), type: 'pedal', down });
  }

  /** Stop and return the take (null if nothing was played). Leading silence is trimmed. */
  stop(meta: { songId?: string | null; songName?: string }): Take | null {
    if (!this.recording) return null;
    const end = this.time(performance.now());
    for (const n of this.held) this.events.push({ t: end, type: 'off', note: n });
    if (this.pedal) this.events.push({ t: end, type: 'pedal', down: false });
    this.recording = false;
    const ons = this.events.filter((e) => e.type === 'on');
    if (!ons.length) return null;
    const lead = Math.max(0, ons[0].t - 0.5);
    const events = this.events.map((e) => ({ ...e, t: Math.max(0, e.t - lead) }));
    const lastOff = events.reduce((m, e) => Math.max(m, e.t), 0);
    const date = Date.now();
    return {
      id: `take-${date}`,
      name: defaultTakeName(date, meta.songName),
      date,
      duration: Math.max(lastOff + 0.5, 1),
      events,
      songId: meta.songId ?? null,
      songName: meta.songName,
      noteCount: ons.length,
    };
  }
}

function defaultTakeName(date: number, songName?: string) {
  const d = new Date(date);
  const stamp = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return songName ? `${songName} - ${stamp}` : `Recording - ${stamp}`;
}

/** Pair note-ons with note-offs and apply the sustain pedal. */
export function takeToNotes(take: Take): TakeNote[] {
  const open = new Map<number, { start: number; vel: number }>();
  const notes: TakeNote[] = [];
  const pedalSpans: [number, number][] = [];
  let pedalDown = -1;
  for (const e of take.events) {
    if (e.type === 'on') {
      const prev = open.get(e.note);
      if (prev) notes.push({ pitch: e.note, velocity: prev.vel, start: prev.start, end: e.t, soundEnd: e.t });
      open.set(e.note, { start: e.t, vel: e.vel });
    } else if (e.type === 'off') {
      const on = open.get(e.note);
      if (on) { notes.push({ pitch: e.note, velocity: on.vel, start: on.start, end: Math.max(e.t, on.start + 0.02), soundEnd: e.t }); open.delete(e.note); }
    } else if (e.down && pedalDown < 0) pedalDown = e.t;
    else if (!e.down && pedalDown >= 0) { pedalSpans.push([pedalDown, e.t]); pedalDown = -1; }
  }
  for (const [n, on] of open) notes.push({ pitch: n, velocity: on.vel, start: on.start, end: take.duration, soundEnd: take.duration });
  if (pedalDown >= 0) pedalSpans.push([pedalDown, take.duration]);
  for (const n of notes) {
    const span = pedalSpans.find(([a, b]) => a <= n.end && b > n.end);
    n.soundEnd = span ? span[1] : n.end;
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Standard MIDI file of the take at 120 BPM (1 beat = 0.5 s), so timing is exact. */
export function takeToMidi(take: Take): Uint8Array {
  const TPB = 480;
  const tick = (t: number) => Math.round(t * 2 * TPB);
  const notes = takeToNotes(take).map((n) => ({ tick: tick(n.start), duration: Math.max(1, tick(n.end) - tick(n.start)), pitch: n.pitch, velocity: n.velocity }));
  const sustain = take.events.filter((e): e is Extract<RecEvent, { type: 'pedal' }> => e.type === 'pedal').map((e) => ({ tick: tick(e.t), on: e.down }));
  return writeMidi([
    { name: take.name, tempos: [{ tick: 0, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
    { name: 'Piano', program: 0, channel: 0, notes, sustain },
  ], TPB);
}
