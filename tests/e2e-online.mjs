// E2E: online search (BitMidi API mocked) and import from link.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ok = []; const check = (n, c, d = '') => { ok.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const midi = fs.readFileSync('/tmp/long.mid');
const midi2 = Buffer.concat([midi, Buffer.from([0])]); // different bytes → a different library entry
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const cors = { 'Access-Control-Allow-Origin': '*' };
let searched = '';
await page.route('https://bitmidi.com/**', async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/api/midi/search') {
    searched = u.searchParams.get('q');
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ result: { total: 2, pageTotal: 1, results: [
      { id: 1, name: 'Beethoven - Fur Elise.mid', url: '/fur-elise-mid', downloadUrl: '/uploads/1.mid', plays: 52011 },
      { id: 2, name: 'Fur_Elise_piano_solo.mid', url: '/fur-elise-2-mid', downloadUrl: '/uploads/2.mid', plays: 812 },
    ] } }) });
  }
  if (u.pathname === '/uploads/1.mid') return route.fulfill({ headers: cors, contentType: 'audio/midi', body: midi });
  return route.fulfill({ status: 404, headers: cors, body: 'nope' });
});
await page.route('https://example.org/**', (r) => r.fulfill({ headers: cors, body: r.request().url().endsWith('.mid') ? midi2 : '<html>not midi</html>' }));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.keystep?.song);
await page.click('.song-btn');
await page.click('text=Find online');
await page.fill('input[type=search]', 'fur elise');
await page.keyboard.press('Enter');
await page.waitForSelector('text=Beethoven - Fur Elise');
check('Search queries BitMidi', searched === 'fur elise', searched);
await page.screenshot({ path: '/home/claude/shots/online-search.png' });
await page.click('text=Beethoven - Fur Elise');
await page.waitForFunction(() => window.keystep.song?.title === 'Beethoven - Fur Elise', null, { timeout: 8000 }).catch(() => {});
const s = await page.evaluate(() => ({ title: window.keystep.song.title, n: window.keystep.song.notes.length, inLib: window.keystep.library.some((x) => x.name === 'Beethoven - Fur Elise') }));
check('Tapping a result downloads and opens it', s.title === 'Beethoven - Fur Elise' && s.n > 1000, JSON.stringify(s));
check('Downloaded song is saved in the library', s.inLib);
await page.screenshot({ path: '/home/claude/shots/online-opened.png' });
// Import from link
await page.click('.song-btn');
await page.click('text=Find online');
await page.fill('input[type=url]', 'https://example.org/notamidi');
await page.click('form >> text=Open');
await page.waitForFunction(() => !!window.keystep.error, null, { timeout: 5000 }).catch(() => {});
const err = await page.evaluate(() => window.keystep.error);
check('A non-MIDI link gives a clear error', /not a MIDI or zip file/.test(err || ''), err);
await page.evaluate(() => { window.keystep.error = null; });
await page.fill('input[type=url]', 'https://example.org/songs/My%20Song.mid');
await page.click('form >> text=Open');
await page.waitForFunction(() => window.keystep.song?.title === 'My Song', null, { timeout: 8000 }).catch(() => {});
check('Import from a direct .mid link works', await page.evaluate(() => window.keystep.song.title === 'My Song'), await page.evaluate(() => window.keystep.song.title));
check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`${ok.filter(Boolean).length}/${ok.length} passed`);
