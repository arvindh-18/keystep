import { describe, it, expect, vi } from 'vitest';
import { Recorder, takeToNotes, takeToMidi } from '../src/engine/recorder';
import { parseMidi } from '../src/engine/midiParser';
import { buildSong } from '../src/engine/timeline';

describe('Recorder', () => {
  it('captures notes, velocity and pedal, trims leading silence, round-trips to MIDI', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = new Recorder();
    r.start();
    now = 3000; r.noteOn(60, 100, now);           // 2.0 s (trimmed to 0.5)
    now = 3500; r.setPedal(true, now);
    now = 3600; r.noteOff(60, now);              // key up, pedal holds
    now = 4000; r.noteOn(64, 50, now);
    now = 4500; r.noteOff(64, now);
    now = 5000; r.setPedal(false, now);
    now = 5200; r.noteOn(67, 80, now);           // still held at stop
    now = 6000;
    const take = r.stop({ songName: 'Test' })!;
    expect(take.noteCount).toBe(3);
    const notes = takeToNotes(take);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(notes[0].start).toBeCloseTo(0.5, 3);
    expect(notes[0].end).toBeCloseTo(1.1, 3);
    expect(notes[0].soundEnd).toBeCloseTo(2.5, 3);  // sustained until pedal up
    expect(notes[1].velocity).toBe(50);
    expect(notes[2].end).toBeCloseTo(3.5, 3);       // closed at stop
    const song = buildSong(parseMidi(takeToMidi(take)), 'x');
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
    expect(song.notes[0].start).toBeCloseTo(0.5, 2);
    expect(song.notes[1].start).toBeCloseTo(1.5, 2);
    expect(song.sustain).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('returns null when nothing was played', () => {
    const r = new Recorder();
    r.start();
    expect(r.stop({})).toBeNull();
  });
});
