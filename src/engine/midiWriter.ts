// Minimal SMF type-1 writer. Used for test fixtures, the built-in demo songs
// and exporting transposed songs.

export interface WriterNote { tick: number; duration: number; pitch: number; velocity?: number; channel?: number }
export interface WriterTrack {
  name?: string;
  program?: number;
  channel?: number;
  notes?: WriterNote[];
  tempos?: { tick: number; bpm: number }[];
  timeSignatures?: { tick: number; numerator: number; denominator: number }[];
  sustain?: { tick: number; on: boolean }[];
  /** Encode note-offs as note-on velocity 0 with running status. */
  runningStatus?: boolean;
}

function varLen(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
}

export function writeMidi(tracks: WriterTrack[], ticksPerBeat = 480): Uint8Array {
  const out: number[] = [];
  const push32 = (n: number) => out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  out.push(0x4d, 0x54, 0x68, 0x64); push32(6);
  out.push(0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (ticksPerBeat >> 8) & 255, ticksPerBeat & 255);

  for (const t of tracks) {
    type Ev = { tick: number; prio: number; bytes: number[] };
    const evs: Ev[] = [];
    const ch = t.channel ?? 0;
    if (t.name) {
      const enc = Array.from(new TextEncoder().encode(t.name));
      evs.push({ tick: 0, prio: 0, bytes: [0xff, 0x03, ...varLen(enc.length), ...enc] });
    }
    for (const ts of t.timeSignatures ?? []) evs.push({ tick: ts.tick, prio: 0, bytes: [0xff, 0x58, 4, ts.numerator, Math.log2(ts.denominator), 24, 8] });
    for (const tp of t.tempos ?? []) {
      const us = Math.round(6e7 / tp.bpm);
      evs.push({ tick: tp.tick, prio: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
    }
    if (t.program !== undefined) evs.push({ tick: 0, prio: 1, bytes: [0xc0 | ch, t.program] });
    for (const s of t.sustain ?? []) evs.push({ tick: s.tick, prio: 2, bytes: [0xb0 | ch, 64, s.on ? 127 : 0] });
    for (const n of t.notes ?? []) {
      const c = n.channel ?? ch;
      evs.push({ tick: n.tick, prio: 3, bytes: [0x90 | c, n.pitch, n.velocity ?? 80] });
      evs.push({ tick: n.tick + n.duration, prio: 1, bytes: t.runningStatus ? [0x90 | c, n.pitch, 0] : [0x80 | c, n.pitch, 64] });
    }
    evs.sort((a, b) => a.tick - b.tick || a.prio - b.prio);
    const body: number[] = [];
    let last = 0, running = 0;
    for (const e of evs) {
      body.push(...varLen(e.tick - last));
      last = e.tick;
      if (t.runningStatus && e.bytes[0] < 0xf0 && e.bytes[0] === running) body.push(...e.bytes.slice(1));
      else { body.push(...e.bytes); running = e.bytes[0] < 0xf0 ? e.bytes[0] : 0; }
    }
    body.push(0, 0xff, 0x2f, 0);
    out.push(0x4d, 0x54, 0x72, 0x6b); push32(body.length); for (const b of body) out.push(b);
  }
  return new Uint8Array(out);
}
