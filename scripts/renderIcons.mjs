// Renders public/icon.svg to PNG icons for desktop, PWA and Android.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const svg = fs.readFileSync('public/icon.svg', 'utf8');
// Android adaptive foreground: bars only, inside the 66% safe zone, transparent background.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(0.62) translate(-256 -256)">${svg.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect width="512" height="512"[^>]*\/>/, '')}</g></svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(src, size, out, bg = 'transparent') {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
fs.mkdirSync('build', { recursive: true });
await render(svg, 1024, 'build/icon.png');
await render(svg, 512, 'public/icon-512.png');
await render(svg, 192, 'public/icon-192.png');
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
fs.mkdirSync('build/android', { recursive: true });
for (const [d, s] of Object.entries(sizes)) {
  await render(svg, s, `build/android/ic_launcher-${d}.png`);
  await render(fg, Math.round(s * 2.25), `build/android/ic_launcher_foreground-${d}.png`);
}
await browser.close();
console.log('icons rendered');
