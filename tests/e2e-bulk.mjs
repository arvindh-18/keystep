// E2E: bulk import of a zip bundle and of a folder.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ok = []; const check = (n, c, d = '') => { ok.push(c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.keystep?.song);
const before = await page.evaluate(() => window.keystep.library.length);
await page.click('.song-btn');
const t0 = Date.now();
await page.setInputFiles('input[type=file][accept*=".zip"]', '/tmp/Tamil songs midi.zip');
await page.waitForFunction(() => !!window.keystep.notice, null, { timeout: 30000 });
const r = await page.evaluate(() => ({ notice: window.keystep.notice, n: window.keystep.library.length }));
check('Zip bundle: all songs added, duplicates and broken files reported', r.n - before === 30 && /Added 30 songs/.test(r.notice) && /5 already there/.test(r.notice) && /1 unreadable/.test(r.notice), `${r.notice} (${Date.now() - t0} ms)`);
const tamil = await page.evaluate(() => window.keystep.library.map((s) => s.name).filter((n) => /சின்ன|உயிரே/.test(n)).length);
check('Tamil-script file names are kept', tamil >= 2, `${tamil} songs`);
await page.screenshot({ path: '/home/claude/shots/bulk-import.png' });
await page.click('text=Kanmani Anbodu 4');
await page.waitForFunction(() => window.keystep.song?.title === 'Kanmani Anbodu 4', null, { timeout: 5000 }).catch(() => {});
check('An imported song opens', await page.evaluate(() => window.keystep.song?.title === 'Kanmani Anbodu 4'));
// Folder import: same files again → all duplicates
await page.click('.song-btn');
await page.setInputFiles('input[type=file][webkitdirectory]', '/tmp/bundle').catch((e) => console.log('folder input:', e.message.split('\n')[0]));
await page.waitForFunction(() => /already there/.test(window.keystep.notice || '') && !/Added 30/.test(window.keystep.notice), null, { timeout: 30000 }).catch(() => {});
const f = await page.evaluate(() => window.keystep.notice);
// (The test harness can't pass non-ASCII file names in folder uploads, so those 4 count as unreadable here.)
check('Folder import works, skips songs already in the library, survives unreadable files', /Added 0 songs/.test(f || '') && /(26|30) already there/.test(f || ''), f);
check('No page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`${ok.filter(Boolean).length}/${ok.length} passed`);
