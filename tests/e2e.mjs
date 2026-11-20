// End-to-end checks in headless Chromium with a simulated MIDI keyboard.
// Run: npx vite preview --port 4173 & node tests/e2e.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright');

const URL = process.env.APP_URL || 'http://localhost:4173/';
const OUT = process.env.SHOTS || '/home/claude/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// Fake Web MIDI: one keyboard input + one output, controllable from the test.
const fakeMidi = () => {
  const listeners = [];
  const input = { id: 'fake-in', name: 'Test Keyboard', manufacturer: 'Keystep QA', state: 'connected', type: 'input', onmidimessage: null };
  const sent = [];
  const output = { id: 'fake-out', name: 'Test Keyboard', manufacturer: 'Keystep QA', state: 'connected', type: 'output', send: (d, t) => sent.push({ d: Array.from(d), t }) };
  const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null, sysexEnabled: false };
  navigator.requestMIDIAccess = async () => access;
  window.__midi = {
    send(bytes) { input.onmidimessage && input.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() }); },
    on(n, v = 90) { this.send([0x90, n, v]); },
    off(n) { this.send([0x80, n, 0]); },
    tap(n) { this.on(n); this.off(n); },
    disconnect() { input.state = 'disconnected'; access.onstatechange && access.onstatechange({ port: input }); },
    reconnect() { input.state = 'connected'; access.onstatechange && access.onstatechange({ port: input }); },
    sent,
  };
  void listeners;
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(fakeMidi);
await page.goto(URL);
await page.waitForFunction(() => window.keystep && window.keystep.song, null, { timeout: 15000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

check('App loads with a demo song', await ev(() => window.keystep.song.title === 'Ode to Joy'), await ev(() => window.keystep.song.title));
check('Fake MIDI keyboard detected', await ev(() => window.keystep.midi.devices.some((d) => d.name === 'Test Keyboard' && d.connected)));
await page.screenshot({ path: `${OUT}/desktop-1440.png` });

// ---- Wait mode with chords ----
await ev(async () => {
  const s = window.keystep;
  await s.openStored('demo-chords');
  s.update({ mode: 'wait', hands: 'both', countIn: false, speed: 1, metronome: false });
});
await page.click('.play-btn');
await sleep(900);
let st = await ev(() => { const s = window.keystep; return { waiting: s.transport.waiting, t: s.transport.time, pending: s.match.pendingPitches(), g0: s.match.current?.time }; });
check('Wait mode holds at the first chord', st.waiting && Math.abs(st.t - st.g0) < 0.02, `t=${st.t.toFixed(3)} group=${st.g0?.toFixed(3)}`);
check('First chord requires C3 + C4 E4 G4', JSON.stringify(st.pending) === JSON.stringify([48, 60, 64, 67]), JSON.stringify(st.pending));
await page.screenshot({ path: `${OUT}/wait-mode-holding.png` });

await ev(() => window.__midi.tap(61));
await sleep(80);
st = await ev(() => ({ wrong: window.keystep.stats.wrong, waiting: window.keystep.transport.waiting, cursor: window.keystep.match.cursor }));
check('Wrong note is counted and does not advance', st.wrong === 1 && st.waiting && st.cursor === 0, JSON.stringify(st));

await ev(() => { window.__midi.on(67); window.__midi.on(48); window.__midi.on(60); });
await sleep(60);
st = await ev(() => ({ pending: window.keystep.match.pendingPitches(), waiting: window.keystep.transport.waiting }));
check('Partial chord keeps waiting', st.waiting && JSON.stringify(st.pending) === '[64]', JSON.stringify(st));
await page.screenshot({ path: `${OUT}/wait-mode-partial-chord.png` });
await ev(() => window.__midi.on(64));
await sleep(150);
st = await ev(() => ({ cursor: window.keystep.match.cursor, waiting: window.keystep.transport.waiting, t: window.keystep.transport.time }));
check('Completing the chord in any order advances', st.cursor === 1 && !st.waiting, JSON.stringify(st));
await ev(() => [48, 60, 64, 67].forEach((n) => window.__midi.off(n)));
// Held keys from the previous chord must not satisfy the next one (repeated C4 E4 G4).
await sleep(2400);
st = await ev(() => { const s = window.keystep; return { waiting: s.transport.waiting, pending: s.match.pendingPitches(), t: s.transport.time, g: s.match.current?.time }; });
check('Holds again at the next chord (repeated notes need new presses)', st.waiting && st.pending.includes(60) && Math.abs(st.t - st.g) < 0.02, JSON.stringify(st));

// ---- Hands separately ----
await ev(() => window.keystep.update({ hands: 'left' }));
await sleep(200);
st = await ev(() => ({ pending: window.keystep.match.pendingPitches() }));
check('Left hand only: just the bass note is required', st.pending.length === 1 && st.pending[0] < 60, JSON.stringify(st.pending));
await ev(() => window.keystep.update({ hands: 'right' }));
await sleep(200);
st = await ev(() => ({ pending: window.keystep.match.pendingPitches() }));
check('Right hand only: just the treble chord is required', st.pending.every((p) => p >= 59) && st.pending.length === 3, JSON.stringify(st.pending));
await ev(() => window.keystep.pause());

// ---- Playback sync and tempo ----
await ev(() => { const s = window.keystep; s.update({ mode: 'listen', hands: 'both', countIn: false, speed: 1 }); s.seek(0); });
await ev(() => window.keystep.play());
const w0 = await ev(() => ({ t: window.keystep.transport.time, w: performance.now() }));
await sleep(1500);
const w1 = await ev(() => ({ t: window.keystep.transport.time, w: performance.now() }));
const rate1 = (w1.t - w0.t) / ((w1.w - w0.w) / 1000);
check('Listen mode: song time tracks the clock at 100%', Math.abs(rate1 - 1) < 0.06, `rate=${rate1.toFixed(3)}`);
await ev(() => window.keystep.setSpeed(0.5));
const w2 = await ev(() => ({ t: window.keystep.transport.time, w: performance.now() }));
await sleep(1500);
const w3 = await ev(() => ({ t: window.keystep.transport.time, w: performance.now() }));
const rate2 = (w3.t - w2.t) / ((w3.w - w2.w) / 1000);
check('Speed 50% halves the song rate', Math.abs(rate2 - 0.5) < 0.04, `rate=${rate2.toFixed(3)}`);
check('Speed change keeps position continuous', Math.abs(w2.t - w1.t) < 0.25, `jump=${(w2.t - w1.t).toFixed(3)}`);
await ev(() => window.keystep.pause());

// ---- Tempo-change file: displayed positions follow the tempo map ----
const tempoOk = await ev(() => {
  const s = window.keystep;
  return s.library.some((x) => x.id === 'demo-waltz');
});
if (tempoOk) {
  await ev(() => window.keystep.openStored('demo-waltz'));
  const tm = await ev(() => window.keystep.song.tempos.map((t) => Math.round(t.bpm)));
  check('Tempo changes are read from the file', JSON.stringify(tm) === '[132,104,80]', JSON.stringify(tm));
}

// ---- Loop with play-along scoring ----
await ev(async () => {
  const s = window.keystep;
  await s.openStored('demo-scales');
  s.update({ mode: 'playalong', hands: 'right', countIn: false, speed: 1.5 });
  s.setLoop({ enabled: true, startMeasure: 0, endMeasure: 0 });
  s.resetStats();
});
await ev(() => window.keystep.play());
await sleep(3800);
st = await ev(() => ({ loops: window.keystep.stats.loopsCompleted, missed: window.keystep.stats.missed, t: window.keystep.transport.time, end: window.keystep.loopTimes().end }));
check('Loop repeats the section', st.loops >= 1 && st.t <= st.end + 0.05, JSON.stringify(st));
check('Play-along counts untouched notes as missed', st.missed >= 4, `missed=${st.missed}`);
await page.screenshot({ path: `${OUT}/playalong-loop.png` });
await ev(() => { window.keystep.pause(); window.keystep.setLoop({ enabled: false }); });

// ---- Count-in ----
await ev(() => { const s = window.keystep; s.update({ mode: 'wait', countIn: true, speed: 1, hands: 'both' }); s.seek(0); });
await ev(() => window.keystep.play());
await sleep(300);
st = await ev(() => ({ t: window.keystep.transport.time, ci: window.keystep.countIn }));
check('Count-in starts one measure early', st.ci && st.t < 0, JSON.stringify(st));
await page.screenshot({ path: `${OUT}/count-in.png` });
await ev(() => window.keystep.pause());

// ---- Device disconnect / reconnect ----
await ev(() => window.__midi.disconnect());
await sleep(100);
const disc = await ev(() => window.keystep.midi.devices.find((d) => d.kind === 'input').connected);
await ev(() => window.__midi.reconnect());
await sleep(100);
const reco = await ev(() => window.keystep.midi.devices.find((d) => d.kind === 'input').connected);
check('Disconnect is detected and the device comes back on reconnect', disc === false && reco === true);
await ev(() => window.__midi.tap(60));
check('Input works after reconnect', await ev(() => window.keystep.midi.lastActivity > 0));

// ---- Light-up hints via MIDI out ----
await ev(async () => { const s = window.keystep; await s.midi.setOutput('fake-out'); s.update({ lightHints: true, mode: 'wait', countIn: false }); s.seek(0); });
await ev(() => window.keystep.play());
await sleep(600);
const hints = await ev(() => window.__midi.sent.filter((m) => (m.d[0] & 0xf0) === 0x90 && m.d[2] === 1).length);
check('Light-up hints are sent to the MIDI output', hints > 0, `hint notes=${hints}`);
await ev(() => { window.keystep.pause(); window.keystep.update({ lightHints: false }); });

// ---- On-screen keyboard (pointer) ----
await ev(() => { const s = window.keystep; s.update({ mode: 'free' }); });
const geom = await ev(() => { const c = document.querySelector('.stage canvas').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; });
await page.mouse.move(geom.x + geom.w / 2, geom.y + geom.h - 20);
await page.mouse.down();
await sleep(50);
const heldScreen = await ev(() => [...window.keystep.held.keys()]);
await page.mouse.up();
check('Clicking the on-screen piano plays a note', heldScreen.length === 1, JSON.stringify(heldScreen));

// ---- Computer keyboard piano ----
await page.keyboard.down('KeyA');
await sleep(40);
const heldKey = await ev(() => [...window.keystep.held.keys()]);
await page.keyboard.up('KeyA');
check('Computer keyboard plays C4 on A', heldKey.includes(60), JSON.stringify(heldKey));

// ---- Library import of a real file ----
const big = fs.readFileSync(process.env.BIG_MID || '/tmp/long.mid');
await ev(async (b64) => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  await window.keystep.importBytes(u.buffer, 'Long Stress Test.mid');
}, big.toString('base64'));
st = await ev(() => ({ n: window.keystep.song.notes.length, title: window.keystep.song.title, tracks: window.keystep.song.tracks.length }));
check('Imports a long multi-track MIDI file', st.n > 15000, JSON.stringify(st));
await ev(() => { const s = window.keystep; s.update({ mode: 'listen', speed: 1 }); s.seek(30); });
await ev(() => window.keystep.play());
await sleep(3000);
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
check('Long file renders smoothly', fps >= 45, `${fps} fps`);
await page.screenshot({ path: `${OUT}/long-file.png` });
await ev(() => window.keystep.pause());

// ---- UI sheets ----
await ev(() => window.keystep.openStored('demo-ode'));
await page.click('button[title="MIDI devices"]');
await sleep(200);
await page.screenshot({ path: `${OUT}/devices.png` });
await page.keyboard.press('Escape');
await page.click('.scrim', { position: { x: 5, y: 5 } }).catch(() => {});
await page.click('.song-btn');
await sleep(200);
await page.screenshot({ path: `${OUT}/library.png` });
await page.click('.scrim', { position: { x: 5, y: 5 } }).catch(() => {});
await page.click('button[aria-label="Statistics"]');
await sleep(200);
await page.screenshot({ path: `${OUT}/stats.png` });
await page.click('.scrim', { position: { x: 5, y: 5 } }).catch(() => {});
await page.click('button[aria-label="Settings"]');
await sleep(200);
await page.screenshot({ path: `${OUT}/settings.png` });
await page.click('.scrim', { position: { x: 5, y: 5 } }).catch(() => {});

// ---- Responsive layouts ----
for (const [w, h, name] of [[360, 740, 'phone-portrait'], [800, 360, 'phone-landscape'], [1024, 768, 'tablet'], [1920, 1080, 'desktop-1080']]) {
  await page.setViewportSize({ width: w, height: h });
  await sleep(350);
  const overflow = await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollHeight > window.innerHeight + 1);
  check(`Layout fits at ${w}×${h}`, !overflow);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
// Wait-mode screenshot at phone landscape (main Android case)
await ev(async () => { const s = window.keystep; await s.openStored('demo-ode'); s.update({ mode: 'wait', countIn: false, hands: 'both' }); s.seek(0); });
await ev(() => window.keystep.play());
await sleep(700);
await page.screenshot({ path: `${OUT}/phone-landscape-wait.png` });
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(300);
await page.screenshot({ path: `${OUT}/desktop-wait.png` });

check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
