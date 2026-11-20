// Parses every MIDI file in a folder with Keystep's own engine and reports results.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parseMidi } from '../src/engine/midiParser';
import { buildSong } from '../src/engine/timeline';
const dir = process.argv[2];
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dir);
let ok = 0; const bad: string[] = []; const empty: string[] = []; let notes = 0; let dur = 0; let maxDur = 0; let longest = '';
for (const f of files) {
  try {
    const s = buildSong(parseMidi(readFileSync(f)), f);
    if (!s.notes.length) { empty.push(f); continue; }
    ok++; notes += s.notes.length; dur += s.duration;
    if (s.duration > maxDur) { maxDur = s.duration; longest = f.split('/').pop()!; }
  } catch (e) { bad.push(`${f.split('/').pop()}: ${(e as Error).message}`); }
}
console.log(JSON.stringify({ total: files.length, playable: ok, noNotes: empty.map((e) => e.split('/').pop()), unreadable: bad, totalNotes: notes, totalMinutes: Math.round(dur / 60), longest: `${longest} (${Math.round(maxDur)}s)` }, null, 1));
