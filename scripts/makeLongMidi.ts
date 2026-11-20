// Generates a long, dense, multi-track MIDI file for stress tests.
import { writeFileSync } from 'fs';
import { writeMidi } from '../src/engine/midiWriter';
const out = process.argv[2] ?? '/tmp/long.mid';
const Q = 480, beats = 2400; // ~20 min at 120 bpm
const rh = [], lh = [], pad = [], drums = [];
for (let b = 0; b < beats; b++) {
  for (let k = 0; k < 4; k++) rh.push({ tick: b * Q + k * 120, duration: 110, pitch: 64 + ((b * 3 + k * 5) % 20) });
  lh.push({ tick: b * Q, duration: 460, pitch: 40 + (b % 12) });
  lh.push({ tick: b * Q, duration: 460, pitch: 47 + (b % 12) });
  if (b % 4 === 0) [60, 64, 67].forEach((p) => pad.push({ tick: b * Q, duration: 4 * Q - 20, pitch: p + (b % 5) }));
  drums.push({ tick: b * Q, duration: 60, pitch: b % 2 ? 38 : 36, channel: 9 });
}
const bytes = writeMidi([
  { name: 'Long Stress Test', tempos: [{ tick: 0, bpm: 120 }, { tick: 600 * Q, bpm: 96 }, { tick: 1200 * Q, bpm: 140 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }] },
  { name: 'Piano RH', program: 0, channel: 0, notes: rh, sustain: Array.from({ length: 600 }, (_, i) => ({ tick: i * 4 * Q + (i % 2 ? 0 : 2), on: true })).flatMap((s) => [s, { tick: s.tick + 3 * Q, on: false }]) },
  { name: 'Piano LH', program: 0, channel: 1, notes: lh },
  { name: 'Strings', program: 48, channel: 2, notes: pad },
  { name: 'Drums', channel: 9, notes: drums },
]);
writeFileSync(out, bytes);
console.log('wrote', out, bytes.length, 'bytes', rh.length + lh.length + pad.length + drums.length, 'notes');
