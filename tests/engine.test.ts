import { describe, it, expect } from 'vitest';
import { parseMidi, MidiParseError } from '../src/engine/midiParser';
import { buildSong, measureAt, handOf, TempoMap } from '../src/engine/timeline';
import { writeMidi } from '../src/engine/midiWriter';
import { MatchEngine, buildGroups, defaultMatchOptions } from '../src/engine/waitEngine';
import { Transport } from '../src/engine/transport';

const TPB = 480;
const song = (tracks: Parameters<typeof writeMidi>[0], title = 't') => buildSong(parseMidi(writeMidi(tracks, TPB)), title);
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('MIDI parser', () => {
  it('parses header and tracks', () => {
    const data = parseMidi(writeMidi([{ name: 'Piano', notes: [{ tick: 0, duration: 480, pitch: 60 }] }], 96));
    expect(data.format).toBe(1);
    expect(data.ticksPerBeat).toBe(96);
    expect(data.tracks).toHaveLength(1);
    expect(data.tracks[0].events.some((e) => e.kind === 'trackName' && e.text === 'Piano')).toBe(true);
  });

  it('handles running status and note-on velocity 0 as note-off', () => {
    const s = song([{ runningStatus: true, notes: [{ tick: 0, duration: 240, pitch: 60 }, { tick: 240, duration: 240, pitch: 62 }, { tick: 480, duration: 480, pitch: 64 }] }]);
    expect(s.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    close(s.notes[0].end, 0.25);
    close(s.notes[2].end - s.notes[2].start, 0.5);
  });

  it('skips sysex messages without shifting timing', () => {
    // track: GM-reset sysex ×3 at t=0, tempo 240 BPM, then a note at tick 480 (= 0.25 s)
    const body = [
      0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7,
      0x00, 0xf0, 0x08, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7,
      0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7,
      0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90,
      0x83, 0x60, 0x90, 60, 100,
      0x83, 0x60, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const bytes = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);
    const s = buildSong(parseMidi(bytes), 'sysex');
    expect(s.tempos[0].bpm).toBeCloseTo(240, 3);
    expect(s.tempos[0].tick).toBe(0);
    close(s.notes[0].start, 0.25);
    close(s.notes[0].end, 0.5);
  });

  it('keeps the playable part of a truncated track', () => {
    const full = writeMidi([{ notes: [{ tick: 0, duration: 240, pitch: 60 }, { tick: 480, duration: 240, pitch: 62 }, { tick: 960, duration: 240, pitch: 64 }] }], TPB);
    const cut = full.slice(0, full.length - 9); // chop off the last note-off and end-of-track
    const s = buildSong(parseMidi(cut), 'cut');
    expect(s.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
  });

  it('rejects non-MIDI data', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))).toThrow(MidiParseError);
  });

  it('decodes UTF-8 and Latin-1 track names', () => {
    const s = song([{ name: 'Für Elise', notes: [{ tick: 0, duration: 10, pitch: 60 }] }]);
    expect(s.tracks[0].name).toBe('Für Elise');
  });
});

describe('Tempo map', () => {
  it('converts ticks to seconds at default 120 BPM', () => {
    const tm = new TempoMap(480, []);
    close(tm.tickToTime(480), 0.5);
    close(tm.timeToTick(1), 960);
  });

  it('honours tempo changes mid-song (120 → 60 → 180)', () => {
    const s = song([
      { tempos: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }, { tick: 1920, bpm: 180 }] },
      { notes: [
        { tick: 0, duration: 480, pitch: 60 },     // 0.0 – 0.5
        { tick: 960, duration: 480, pitch: 62 },   // 1.0 – 2.0
        { tick: 1920, duration: 480, pitch: 64 },  // 3.0 – 3.333
        { tick: 1440, duration: 960, pitch: 65 },  // spans the change: 2.0 – 3.333
      ] },
    ]);
    const byPitch = Object.fromEntries(s.notes.map((n) => [n.pitch, n]));
    close(byPitch[60].start, 0); close(byPitch[60].end, 0.5);
    close(byPitch[62].start, 1); close(byPitch[62].end, 2);
    close(byPitch[64].start, 3); close(byPitch[64].end, 3 + 1 / 3);
    close(byPitch[65].start, 2); close(byPitch[65].end, 3 + 1 / 3);
    expect(s.tempos.map((t) => Math.round(t.bpm))).toEqual([120, 60, 180]);
  });

  it('round-trips time ↔ tick across segments', () => {
    const tm = new TempoMap(480, [{ tick: 0, microsecondsPerBeat: 500000 }, { tick: 1000, microsecondsPerBeat: 1000000 }]);
    for (const tick of [0, 500, 1000, 1500, 9999]) close(tm.timeToTick(tm.tickToTime(tick)), tick, 1e-6);
  });
});

describe('Measures and time signatures', () => {
  it('builds measures for 4/4 then 3/4', () => {
    const s = song([{ timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 1920, numerator: 3, denominator: 4 }], notes: [{ tick: 1920 + 1440 * 2, duration: 480, pitch: 60 }] }]);
    expect(s.measures[0].numerator).toBe(4);
    close(s.measures[1].start, 2);
    expect(s.measures[1].numerator).toBe(3);
    close(s.measures[2].start, 3.5);
    expect(s.measures[1].beatTimes).toHaveLength(3);
    expect(measureAt(s, 3.6)).toBe(2);
    expect(s.notes[0].measure).toBe(3);
  });

  it('handles 6/8', () => {
    const s = song([{ timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }], notes: [{ tick: 1440, duration: 240, pitch: 60 }] }]);
    close(s.measures[1].start, 1.5); // 6 eighths at 120 bpm quarter = 1.5s
    expect(s.measures[0].beatTimes).toHaveLength(6);
  });
});

describe('Notes, tracks and sustain', () => {
  it('pairs overlapping repeated notes on the same key', () => {
    // Second note-on before first note-off: first note ends at the re-strike.
    const s = buildSong(parseMidi(rawTrack([
      [0, 0x90, 60, 100], [240, 0x90, 60, 90], [240, 0x80, 60, 0], [240, 0x80, 60, 0],
    ])), 'x');
    expect(s.notes).toHaveLength(2);
    close(s.notes[0].end, 0.25);
    close(s.notes[1].start, 0.25);
  });

  it('extends sound with the sustain pedal but keeps key duration', () => {
    const s = song([{ sustain: [{ tick: 0, on: true }, { tick: 1920, on: false }], notes: [{ tick: 0, duration: 240, pitch: 60 }, { tick: 1920, duration: 240, pitch: 62 }] }]);
    close(s.notes[0].end, 0.25);
    close(s.notes[0].soundEnd, 2);
    close(s.notes[1].soundEnd, s.notes[1].end);
    expect(s.sustain).toHaveLength(1);
  });

  it('assigns right/left roles by pitch for two piano tracks', () => {
    const s = song([
      { name: 'Piano', program: 0, notes: [{ tick: 0, duration: 100, pitch: 48 }, { tick: 480, duration: 100, pitch: 50 }] },
      { name: 'Piano', program: 0, channel: 1, notes: [{ tick: 0, duration: 100, pitch: 72 }, { tick: 480, duration: 100, pitch: 76 }] },
    ]);
    const roles = s.tracks.map((t) => t.defaultRole);
    expect(roles).toEqual(['left', 'right']);
  });

  it('uses track names for hands, and splits single tracks at middle C', () => {
    const named = song([
      { name: 'Left Hand', notes: [{ tick: 0, duration: 100, pitch: 72 }] },
      { name: 'Right Hand', notes: [{ tick: 0, duration: 100, pitch: 40 }] },
    ]);
    expect(named.tracks.map((t) => t.defaultRole)).toEqual(['left', 'right']);
    const single = song([{ notes: [{ tick: 0, duration: 100, pitch: 48 }, { tick: 0, duration: 100, pitch: 64 }] }]);
    expect(single.tracks[0].defaultRole).toBe('split');
    const roles = single.tracks.map((t) => t.defaultRole);
    expect(single.notes.map((n) => handOf(n, roles))).toEqual(['left', 'right']);
  });

  it('splits a type-0 style track by channel and mutes drums', () => {
    const s = song([{ notes: [{ tick: 0, duration: 100, pitch: 60, channel: 0 }, { tick: 0, duration: 100, pitch: 36, channel: 9 }, { tick: 0, duration: 100, pitch: 40, channel: 1 }] }]);
    expect(s.tracks).toHaveLength(3);
    expect(s.tracks.find((t) => t.isDrum)?.defaultRole).toBe('mute');
  });

  it('parses a long multi-track file quickly', () => {
    const notes = Array.from({ length: 25000 }, (_, i) => ({ tick: i * 60, duration: 120, pitch: 40 + (i % 40) }));
    const t0 = performance.now();
    const s = song([{ tempos: [{ tick: 0, bpm: 100 }], sustain: Array.from({ length: 500 }, (_, i) => ({ tick: i * 3000, on: i % 2 === 0 })) , notes }, { channel: 1, notes: notes.map((n) => ({ ...n, pitch: n.pitch + 30 })) }]);
    expect(s.notes).toHaveLength(50000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('Wait mode matching', () => {
  const mk = (specs: [number, number][]) => song([{ notes: specs.map(([beat, pitch]) => ({ tick: beat * TPB, duration: 400, pitch })) }]).notes;

  it('groups simultaneous notes into chords', () => {
    const g = buildGroups(mk([[0, 60], [0, 64], [0, 67], [1, 62]]), 0.03);
    expect(g).toHaveLength(2);
    expect(g[0].pitches).toEqual([60, 64, 67]);
  });

  it('advances only on the correct note; wrong notes do not advance', () => {
    const e = new MatchEngine();
    let wrong = 0;
    e.events.onWrong = () => wrong++;
    e.load(mk([[0, 60], [1, 62]]));
    expect(e.noteOn(61, 0, 0).verdict).toBe('wrong');
    expect(e.cursor).toBe(0);
    const r = e.noteOn(60, 0, 10);
    expect(r.verdict).toBe('hit');
    expect(r.groupCompleted).toBe(true);
    expect(e.cursor).toBe(1);
    expect(wrong).toBe(1);
  });

  it('requires all chord notes in any order', () => {
    const e = new MatchEngine();
    e.load(mk([[0, 60], [0, 64], [0, 67]]));
    expect(e.noteOn(67, 0, 0).groupCompleted).toBe(false);
    expect(e.noteOn(60, 0, 1).groupCompleted).toBe(false);
    expect(e.pendingPitches()).toEqual([64]);
    expect(e.noteOn(64, 0, 2).groupCompleted).toBe(true);
    expect(e.finished).toBe(true);
  });

  it('chord policy "any" advances on one chord note', () => {
    const e = new MatchEngine({ ...defaultMatchOptions, chordPolicy: 'any' });
    e.load(mk([[0, 60], [0, 64], [1, 65]]));
    expect(e.noteOn(64, 0, 0).groupCompleted).toBe(true);
    expect(e.current?.pitches).toEqual([65]);
  });

  it('roll window resets slow chords', () => {
    const e = new MatchEngine({ ...defaultMatchOptions, rollWindowMs: 500 });
    e.load(mk([[0, 60], [0, 64]]));
    e.noteOn(60, 0, 0);
    expect(e.noteOn(64, 0, 900).groupCompleted).toBe(false); // 60 expired
    expect(e.pendingPitches()).toEqual([60]);
    expect(e.noteOn(60, 0, 1000).groupCompleted).toBe(true);
  });

  it('repeated notes need a fresh key press for each occurrence', () => {
    const e = new MatchEngine();
    e.load(mk([[0, 60], [1, 60], [2, 60]]));
    e.noteOn(60, 0, 0);
    expect(e.cursor).toBe(1);
    // A held key produces no new note-on, so nothing happens until re-struck.
    expect(e.noteOn(60, 0.5, 100).groupCompleted).toBe(true);
    expect(e.cursor).toBe(2);
  });

  it('a duplicate press of an already-hit chord note is not wrong', () => {
    const e = new MatchEngine();
    e.load(mk([[0, 60], [0, 64]]));
    e.noteOn(60, 0, 0);
    expect(e.noteOn(60, 0, 5).verdict).toBe('duplicate');
  });

  it('wrong octave is rejected unless octave-agnostic', () => {
    const strict = new MatchEngine();
    strict.load(mk([[0, 60]]));
    expect(strict.noteOn(72, 0, 0).verdict).toBe('wrong');
    const loose = new MatchEngine({ ...defaultMatchOptions, octaveAgnostic: true });
    loose.load(mk([[0, 60]]));
    expect(loose.noteOn(72, 0, 0).verdict).toBe('hit');
  });

  it('ignores presses far ahead of the next group', () => {
    const e = new MatchEngine();
    e.load(mk([[4, 60]])); // onset 2.0s
    expect(e.noteOn(60, 0.5, 0).verdict).toBe('early-ignored');
    expect(e.noteOn(60, 1.9, 0).verdict).toBe('hit'); // within early tolerance
  });

  it('play-along marks late groups missed and allows skipping ahead', () => {
    const missed: number[] = [];
    const e = new MatchEngine({ ...defaultMatchOptions, allowSkipAhead: true }, { onMissed: (n) => missed.push(n.pitch) });
    e.load(mk([[0, 60], [1, 62], [2, 64], [3, 65]]));
    e.advanceTo(0.3); // 60 missed (late tolerance 0.25)
    expect(missed).toEqual([60]);
    // Player skips 62 and plays 64 near its onset.
    expect(e.noteOn(64, 0.95, 0).verdict).toBe('hit');
    expect(missed).toEqual([60, 62]);
    expect(e.current?.pitches).toEqual([65]);
  });

  it('seek and step back rebuild progress', () => {
    const e = new MatchEngine();
    e.load(mk([[0, 60], [1, 62], [2, 64]]));
    e.seek(0.4);
    expect(e.current?.pitches).toEqual([62]);
    e.noteOn(62, 0.5, 0);
    e.stepBack();
    expect(e.current?.pitches).toEqual([62]);
  });
});

describe('Transport', () => {
  const fake = () => { let t = 0; return { clock: () => t, advance: (d: number) => { t += d; } }; };

  it('advances with rate and pauses', () => {
    const c = fake(); const tr = new Transport(c.clock); tr.duration = 100;
    tr.play(); c.advance(2); close(tr.time, 2);
    tr.setRate(0.5); c.advance(2); close(tr.time, 3);
    tr.pause(); c.advance(5); close(tr.time, 3);
  });

  it('holds at a time and resumes without skipping', () => {
    const c = fake(); const tr = new Transport(c.clock); tr.duration = 100;
    tr.play(); tr.holdAtTime(1);
    c.advance(5); close(tr.time, 1); expect(tr.waiting).toBe(true);
    tr.release(); c.advance(0.5); close(tr.time, 1.5);
  });

  it('wraps at loop end', () => {
    const c = fake(); const tr = new Transport(c.clock); tr.duration = 100;
    tr.loop = { start: 2, end: 4 }; tr.seek(3.5); tr.play();
    c.advance(1); expect(tr.tick()).toBe(true); close(tr.time, 2);
  });

  it('maps song ↔ clock time for scheduling at any rate', () => {
    const c = fake(); const tr = new Transport(c.clock); tr.duration = 100;
    c.advance(10); tr.setRate(0.5); tr.play();
    close(tr.songToClock(1), 12);
    close(tr.clockToSong(12), 1);
  });
});

// Build a single-track file from raw [delta, status, d1, d2] events.
function rawTrack(evs: [number, number, number, number][]): Uint8Array {
  const body: number[] = [];
  for (const [d, s, a, b] of evs) body.push(d < 128 ? d : 0x81, ...(d < 128 ? [] : [d - 128]), s, a, b);
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0, 0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...body]);
}
