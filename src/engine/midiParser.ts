// Standard MIDI File (SMF) parser. Produces raw, tick-based events per track.
// Nothing is converted to seconds here: the timeline module owns timing.

export type RawEvent =
  | { kind: 'noteOn'; tick: number; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; tick: number; channel: number; note: number; velocity: number }
  | { kind: 'controller'; tick: number; channel: number; controller: number; value: number }
  | { kind: 'program'; tick: number; channel: number; program: number }
  | { kind: 'tempo'; tick: number; microsecondsPerBeat: number }
  | { kind: 'timeSignature'; tick: number; numerator: number; denominator: number }
  | { kind: 'keySignature'; tick: number; key: number; scale: number }
  | { kind: 'trackName'; tick: number; text: string }
  | { kind: 'instrumentName'; tick: number; text: string }
  | { kind: 'text'; tick: number; text: string; metaType: number }
  | { kind: 'endOfTrack'; tick: number };

export interface RawTrack {
  events: RawEvent[];
}

export interface MidiFileData {
  format: number;
  ticksPerBeat: number;
  /** SMPTE timing (rare); when set, ticksPerBeat is unused. */
  smpte?: { framesPerSecond: number; ticksPerFrame: number };
  tracks: RawTrack[];
}

export class MidiParseError extends Error {}

class Reader {
  pos = 0;
  constructor(private view: DataView, private end = view.byteLength) {}
  get remaining() { return this.end - this.pos; }
  u8() { if (this.pos >= this.end) throw new MidiParseError('Unexpected end of data'); return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  str(len: number) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  bytes(len: number) {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, Math.min(len, this.end - this.pos));
    this.pos += len;
    return out;
  }
  varLen() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new MidiParseError('Variable-length quantity too long');
  }
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    // Most older files use Latin-1.
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s.trim();
  }
}

export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFileData {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const r = new Reader(view);

  // Some files are wrapped in RIFF (RMID); find the MThd header.
  let start = 0;
  for (let i = 0; i + 4 <= u8.length && i < 1024; i++) {
    if (u8[i] === 0x4d && u8[i + 1] === 0x54 && u8[i + 2] === 0x68 && u8[i + 3] === 0x64) { start = i; break; }
  }
  r.pos = start;
  if (r.remaining < 14 || r.str(4) !== 'MThd') throw new MidiParseError('Not a MIDI file (missing MThd header)');
  const headerLen = r.u32();
  const format = r.u16();
  const declaredTracks = r.u16();
  const division = r.u16();
  r.pos += headerLen - 6;

  const data: MidiFileData = { format, ticksPerBeat: 480, tracks: [] };
  if (division & 0x8000) {
    const fps = -((division >> 8) << 24 >> 24);
    data.smpte = { framesPerSecond: fps === 29 ? 29.97 : fps, ticksPerFrame: division & 0xff };
    data.ticksPerBeat = 480;
  } else {
    data.ticksPerBeat = division || 480;
  }

  while (r.remaining >= 8 && data.tracks.length < Math.max(declaredTracks, 1) + 64) {
    const id = r.str(4);
    const len = r.u32();
    const chunkEnd = Math.min(r.pos + len, view.byteLength);
    if (id !== 'MTrk') { r.pos = chunkEnd; continue; }
    data.tracks.push(parseTrack(new Reader(view, chunkEnd), r.pos));
    r.pos = chunkEnd;
  }
  if (data.tracks.length === 0) throw new MidiParseError('MIDI file contains no tracks');
  return data;
}

function parseTrack(r: Reader, startPos: number): RawTrack {
  const events: RawEvent[] = [];
  try {
    return parseTrackEvents(r, startPos, events);
  } catch (e) {
    // Damaged or truncated track: keep everything read before the damage.
    if (e instanceof MidiParseError || e instanceof RangeError) return { events };
    throw e;
  }
}

function parseTrackEvents(r: Reader, startPos: number, events: RawEvent[]): RawTrack {
  r.pos = startPos;
  let tick = 0;
  let runningStatus = 0;
  while (r.remaining > 0) {
    tick += r.varLen();
    let status = r.u8();
    if (status < 0x80) {
      // Running status: reuse previous channel status; this byte is data.
      if (!runningStatus) throw new MidiParseError('Running status without previous status');
      status = runningStatus;
      r.pos--;
    }
    if (status === 0xff) {
      const type = r.u8();
      const len = r.varLen();
      const body = r.bytes(len);
      switch (type) {
        case 0x51:
          if (len >= 3) events.push({ kind: 'tempo', tick, microsecondsPerBeat: (body[0] << 16) | (body[1] << 8) | body[2] });
          break;
        case 0x58:
          if (len >= 2) events.push({ kind: 'timeSignature', tick, numerator: body[0], denominator: 2 ** body[1] });
          break;
        case 0x59:
          if (len >= 2) events.push({ kind: 'keySignature', tick, key: (body[0] << 24) >> 24, scale: body[1] });
          break;
        case 0x03: events.push({ kind: 'trackName', tick, text: decodeText(body) }); break;
        case 0x04: events.push({ kind: 'instrumentName', tick, text: decodeText(body) }); break;
        case 0x01: case 0x02: case 0x05: case 0x06: case 0x07:
          events.push({ kind: 'text', tick, text: decodeText(body), metaType: type }); break;
        case 0x2f: events.push({ kind: 'endOfTrack', tick }); return { events };
        default: break;
      }
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      // Read the length first: `r.pos += r.varLen()` would lose the length byte(s),
      // because r.pos is read before varLen() advances it.
      const len = r.varLen();
      r.pos += len; // skip sysex data
      continue;
    }
    if (status >= 0xf1) {
      // System common/real-time messages shouldn't appear in files; skip known sizes.
      const sizes: Record<number, number> = { 0xf1: 1, 0xf2: 2, 0xf3: 1 };
      r.pos += sizes[status] ?? 0;
      continue;
    }
    runningStatus = status;
    const type = status & 0xf0;
    const channel = status & 0x0f;
    const d1 = r.u8();
    const d2 = type === 0xc0 || type === 0xd0 ? 0 : r.u8();
    switch (type) {
      case 0x90:
        if (d2 === 0) events.push({ kind: 'noteOff', tick, channel, note: d1, velocity: 64 });
        else events.push({ kind: 'noteOn', tick, channel, note: d1, velocity: d2 });
        break;
      case 0x80: events.push({ kind: 'noteOff', tick, channel, note: d1, velocity: d2 }); break;
      case 0xb0: events.push({ kind: 'controller', tick, channel, controller: d1, value: d2 }); break;
      case 0xc0: events.push({ kind: 'program', tick, channel, program: d1 }); break;
      default: break; // aftertouch, pitch bend: not needed for practice
    }
  }
  return { events };
}
