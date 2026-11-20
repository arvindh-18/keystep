// E2E: library sorting, song preview, listen-first, my-part sound.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ok = []; const check = (n, c, d = '') => { ok.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4173/'); await p.waitForFunction(() => window.keystep?.song);
const sleep = (ms) => p.waitForTimeout(ms);
// Sorting
await p.click('.song-btn');
const names = async () => p.$$eval('.song-row .name', (els) => els.map((e) => e.textContent));
const az = await names();
check('Library sorted A–Z by default', JSON.stringify(az) === JSON.stringify([...az].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))), az.join(', '));
await p.selectOption('select[aria-label="Sort songs"]', 'length');
await sleep(100);
const byLen = await p.evaluate(() => { const lib = window.keystep.library; return [...document.querySelectorAll('.song-row .name')].map((e) => lib.find((s) => s.name === e.textContent)?.durationSec ?? 0); });
check('Sort by length works', byLen.every((v, i) => i === 0 || v >= byLen[i - 1]), byLen.map((v) => Math.round(v)).join(','));
await p.selectOption('select[aria-label="Sort songs"]', 'name');
await p.reload(); await p.waitForFunction(() => window.keystep?.song);
check('Sort choice is remembered', await p.evaluate(() => window.keystep.settings.librarySort === 'name'));
// Preview
await p.click('.song-btn');
await p.click('button[aria-label="Listen to Twinkle, Twinkle"]');
await sleep(1200);
const pv = await p.evaluate(() => ({ id: window.keystep.previewing ?? window.keystep.getSnapshot().previewing, t: window.keystep.previewElapsed, dur: window.keystep.previewDuration }));
check('Preview plays a song from the library', pv.id === 'demo-twinkle' && pv.t > 0.5 && pv.dur > 20, JSON.stringify(pv));
await p.screenshot({ path: '/home/claude/shots/library-preview.png' });
await p.click('button[aria-label="Stop preview"]');
check('Preview stops', await p.evaluate(() => window.keystep.getSnapshot().previewing === null));
await p.click('.scrim', { position: { x: 5, y: 5 } });
// Listen first
await p.evaluate(() => window.keystep.openStored('demo-twinkle'));
await p.evaluate(() => window.keystep.update({ mode: 'wait', countIn: true }));
await p.click('text=Listen to the whole song first');
await sleep(600);
let st = await p.evaluate(() => ({ mode: window.keystep.settings.mode, playing: window.keystep.transport.playing, t: window.keystep.transport.time, lt: window.keystep.getSnapshot().listenThrough }));
check('Listen first plays the song in Listen mode', st.mode === 'listen' && st.playing && st.lt && st.t > 0, JSON.stringify(st));
await p.screenshot({ path: '/home/claude/shots/listen-first.png' });
await p.evaluate(() => window.keystep.transport.seek(window.keystep.song.duration - 0.3));
await sleep(1500);
st = await p.evaluate(() => ({ mode: window.keystep.settings.mode, playing: window.keystep.transport.playing, t: window.keystep.transport.time, countIn: window.keystep.settings.countIn, notice: window.keystep.notice }));
check('After listening it returns to Wait mode at the start', st.mode === 'wait' && !st.playing && st.t < 1 && st.countIn === true && !!st.notice, JSON.stringify(st));
// My part sound
await p.evaluate(() => window.keystep.update({ myPart: 'full', mode: 'wait', hands: 'both' }));
const aud = await p.evaluate(() => { const s = window.keystep; const i = s.notes.findIndex((_, k) => s.isRequired(k)); return [s.audibility(i), (s.update({ myPart: 'quiet' }), s.audibility(i)), (s.update({ myPart: 'off' }), s.audibility(i))]; });
check('My part sound: Full / Quiet / Off', aud[0] === 1 && aud[1] === 0.35 && aud[2] === 0, JSON.stringify(aud));
await p.click('button[aria-label="Practice panel"]').catch(() => {});
check('No page errors', errs.length === 0, errs.join(' | '));
await b.close();
console.log(`${ok.filter(Boolean).length}/${ok.length} passed`);
