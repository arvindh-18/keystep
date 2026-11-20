// Generates the Android project (if missing) and applies Keystep's native files on top.
// Usage: node scripts/prepareAndroid.mjs [--fresh]   (then: cd android && ./gradlew assembleRelease)
// --fresh always regenerates the project (used by CI, so stale or partial uploads can't break it).
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const android = path.join(root, 'android');
const overlay = path.join(root, 'native', 'android');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: root });

const fresh = process.argv.includes('--fresh');
if (fresh || !fs.existsSync(path.join(android, 'app', 'build.gradle'))) {
  fs.rmSync(android, { recursive: true, force: true });
  run('npx cap add android');
}

// Copy every overlay file over the generated project.
const copyDir = (src, dst) => {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); }
    else fs.copyFileSync(s, d);
  }
};
copyDir(overlay, android);

// Remove the template's Capacitor splash images and launcher foregrounds (ours replace them).
const res = path.join(android, 'app', 'src', 'main', 'res');
for (const dir of fs.readdirSync(res)) {
  for (const f of ['splash.png']) {
    const p = path.join(res, dir, f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}
const vectorFg = path.join(res, 'drawable-v24', 'ic_launcher_foreground.xml');
if (fs.existsSync(vectorFg)) fs.rmSync(vectorFg);

fs.chmodSync(path.join(android, 'gradlew'), 0o755);
run('npx cap sync android');
console.log('Android project ready.');
