// Built-in practice pieces (public-domain melodies and original exercises),
// generated as real MIDI files so they go through the same import path.

import { writeMidi, type WriterNote } from './midiWriter';

const Q = 480; // ticks per quarter
const N: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "E4", "F#5", "Bb3" → MIDI number */
function p(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name)!;
  return N[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}
/** Sequence "E4:1 F4:0.5 ..." (beats); "r:1" is a rest; "C4+E4+G4:2" is a chord. */
function seq(s: string, startBeat = 0, velocity = 80): WriterNote[] {
  const out: WriterNote[] = [];
  let beat = startBeat;
  for (const tok of s.trim().split(/\s+/)) {
    const [names, len] = tok.split(':');
    const beats = Number(len);
    if (names !== 'r') for (const n of names.split('+')) out.push({ tick: Math.round(beat * Q), duration: Math.round(beats * Q * 0.92), pitch: p(n), velocity });
    beat += beats;
  }
  return out;
}

function odeToJoy() {
  const rh = seq(`
    E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1.5 D4:0.5 D4:2
    E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2
    D4:1 D4:1 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 C4:1 D4:1 E4:0.5 F4:0.5 E4:1 D4:1 C4:1 D4:1 G3:2
    E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1.5 C4:0.5 C4:2`);
  const lh = seq(`
    C3+G3:4 G2+G3:4 C3+G3:4 G2+F3:2 G2+F3:2
    C3+G3:4 G2+G3:4 C3+G3:4 G2+F3:2 C3+E3:2
    G2+G3:4 C3+G3:4 G2+G3:4 G2+B2:4
    C3+G3:4 G2+G3:4 C3+G3:4 G2+F3:2 C3+E3:2`, 0, 64);
  return writeMidi([
    { name: 'Ode to Joy', tempos: [{ tick: 0, bpm: 100 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
    { name: 'Right Hand', program: 0, channel: 0, notes: rh },
    { name: 'Left Hand', program: 0, channel: 1, notes: lh },
  ]);
}

function twinkle() {
  const rh = seq(`C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2
    G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2
    C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2`);
  const lh = seq(`C3:2 E3:2 F3:2 E3:2 D3:2 C3:2 G2:2 C3:2
    E3:2 D3:2 C3:2 G2:2 E3:2 D3:2 C3:2 G2:2
    C3:2 E3:2 F3:2 E3:2 D3:2 C3:2 G2:2 C3:2`, 0, 62);
  return writeMidi([
    { name: 'Twinkle, Twinkle', tempos: [{ tick: 0, bpm: 92 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
    { name: 'Right Hand', channel: 0, notes: rh },
    { name: 'Left Hand', channel: 1, notes: lh },
  ]);
}

function scalesExercise() {
  const up = 'C4:0.5 D4:0.5 E4:0.5 F4:0.5 G4:0.5 A4:0.5 B4:0.5 C5:0.5';
  const down = 'C5:0.5 B4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:0.5 D4:0.5 C4:0.5';
  const arp = 'C4:0.5 E4:0.5 G4:0.5 C5:0.5 G4:0.5 E4:0.5 C4:1';
  const rh = seq(`${up} ${down} ${up} ${down} ${arp} r:0.5 ${arp} r:0.5`);
  const lh = seq(`C3:0.5 D3:0.5 E3:0.5 F3:0.5 G3:0.5 A3:0.5 B3:0.5 C4:0.5 C4:0.5 B3:0.5 A3:0.5 G3:0.5 F3:0.5 E3:0.5 D3:0.5 C3:0.5 r:8 C3:4 C3:4`, 0, 64);
  return writeMidi([
    { name: 'C Major Scale & Arpeggio', tempos: [{ tick: 0, bpm: 84 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
    { name: 'Right Hand', channel: 0, notes: rh },
    { name: 'Left Hand', channel: 1, notes: lh },
  ]);
}

function chordsExercise() {
  // I–vi–IV–V in C, then I–IV–V–I, blocked chords with a bass line and a pedal.
  const rh = seq(`C4+E4+G4:2 C4+E4+G4:2 C4+E4+A4:2 C4+E4+A4:2 C4+F4+A4:2 C4+F4+A4:2 B3+D4+G4:2 B3+D4+G4:2
    C4+E4+G4:2 C4+F4+A4:2 B3+D4+G4:2 C4+E4+G4:2 C4+F4+A4:2 B3+F4+G4:2 C4+E4+G4:4`);
  const lh = seq(`C3:4 A2:4 F2:4 G2:4 C3:2 F2:2 G2:2 C3:2 F2:2 G2:2 C2+C3:4`, 0, 66);
  const sustain = [0, 4, 8, 12, 16, 18, 20, 22, 24, 26, 28].flatMap((b) => [{ tick: b * Q + 10, on: true }, { tick: (b + (b >= 16 ? 2 : 4)) * Q - 20, on: false }]);
  return writeMidi([
    { name: 'Chord Progressions', tempos: [{ tick: 0, bpm: 76 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
    { name: 'Right Hand', channel: 0, notes: rh, sustain },
    { name: 'Left Hand', channel: 1, notes: lh },
  ]);
}

function waltz() {
  // Original exercise in 3/4 with a tempo change (rit.) at the end.
  const rh = seq(`G4:1 E4:1 F4:1 G4:2 C5:1 B4:1 A4:1 G4:1 F4:2 r:1 F4:1 D4:1 E4:1 F4:2 B4:1 A4:1 G4:1 F4:1 E4:2 r:1
    G4:1 E4:1 F4:1 G4:2 C5:1 D5:1 C5:1 B4:1 A4:2 F4:1 E4:1 D4:1 G4:1 C4:3`);
  const lh = seq(`C3:1 E3+G3:1 E3+G3:1 C3:1 E3+G3:1 E3+G3:1 F2:1 F3+A3:1 F3+A3:1 G2:1 F3+B3:1 F3+B3:1
    G2:1 F3+B3:1 F3+B3:1 G2:1 F3+B3:1 F3+B3:1 C3:1 E3+G3:1 E3+G3:1 C3:1 E3+G3:1 E3+G3:1
    C3:1 E3+G3:1 E3+G3:1 C3:1 E3+G3:1 E3+G3:1 F2:1 F3+A3:1 F3+A3:1 F2:1 F3+A3:1 F3+A3:1 G2:1 F3+B3:1 F3+B3:1 C3+G3:3`, 0, 60);
  return writeMidi([
    { name: 'Little Waltz', tempos: [{ tick: 0, bpm: 132 }, { tick: 33 * Q, bpm: 104 }, { tick: 36 * Q, bpm: 80 }], timeSignatures: [{ tick: 0, numerator: 3, denominator: 4 }] },
    { name: 'Right Hand', channel: 0, notes: rh },
    { name: 'Left Hand', channel: 1, notes: lh },
  ]);
}

export interface DemoSong { id: string; name: string; description: string; make: () => Uint8Array }

export const demoSongs: DemoSong[] = [
  { id: 'demo-ode', name: 'Ode to Joy', description: 'Beethoven · both hands · 4/4', make: odeToJoy },
  { id: 'demo-twinkle', name: 'Twinkle, Twinkle', description: 'Traditional · melody + bass', make: twinkle },
  { id: 'demo-scales', name: 'C Major Scale & Arpeggio', description: 'Exercise · scales, contrary motion', make: scalesExercise },
  { id: 'demo-chords', name: 'Chord Progressions', description: 'Exercise · triads, pedal', make: chordsExercise },
  { id: 'demo-waltz', name: 'Little Waltz', description: 'Exercise · 3/4, ritardando', make: waltz },
];
