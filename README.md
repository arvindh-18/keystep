# Keystep — MIDI piano practice

Import a MIDI file, connect your keyboard, and learn it note by note. The song waits for you.

Runs on **Windows 10/11**, **macOS 11+** (Apple Silicon and Intel) and **Android 10+**.

## Features

- **Wait mode** — the song stops at each note or chord until you play it. Chords in any order; wrong notes flash red and don't advance; repeated notes need a fresh key press; optional chord-roll limit, any-octave matching, and skip/step-back.
- **Play-along** — the song keeps time and scores you: correct, wrong and missed notes, with a timing tolerance.
- **Listen** and **Free** modes; **left / right / both hands**, with the other hand played, played quietly or muted.
- **Speed** 10–150 % with presets (25, 40, 50, 60, 75, 90, 100 %). The tempo map stays exact, including tempo changes in the file.
- **Loops** — drag loop edges on the timeline, Shift-drag to draw one, loop the current measure, count-in before each repeat.
- **Metronome** (woodblock or beep) and a one-measure **count-in**, following time-signature and tempo changes.
- **Falling notes** with note names, sustain-pedal tails, measure lines and numbers, a highlight on the next chord, pinch or Ctrl+scroll to zoom.
- **88-key keyboard** that fits the song or a chosen range (88/76/61/49), with highlights for expected, correct, wrong and held keys. Multi-touch and mouse play, plus the computer keyboard as a piano.
- **MIDI devices** — auto-detect, choose inputs and output, live monitor with velocity and pedal, auto-reconnect, light-up key hints, play the song on your keyboard.
- **Statistics** — accuracy, streaks, practice time, mistakes per measure (click a measure to loop it), history per song.
- **Library** — import by file picker, drag and drop or "Open with"; favourites, rename, search; five built-in practice pieces. Everything is stored only on the device.
- Transpose ±12, MIDI export, latency calibration, keyboard-range limit, file info.

## Install

### Windows 10 / 11
- **Zip build:** unzip `Keystep-1.0.0-Windows-x64.zip` and run `Keystep.exe`.
- **Installer:** `Keystep-1.0.0-Windows-Setup.exe` (built by CI, see below).
- The app isn't code-signed, so SmartScreen may warn: click **More info → Run anyway**.

### macOS
- Unzip `Keystep-1.0.0-macOS-arm64.zip` (Apple Silicon: M1–M4) or `-x64.zip` (Intel) and drag **Keystep** to Applications.
- The app is ad-hoc signed but not notarized. The first time, **right-click → Open → Open**. If macOS says the app is damaged, run this in Terminal once:
  `xattr -cr /Applications/Keystep.app`

### Android 10+
- Install `Keystep-1.0.0-Android.apk`. Allow "Install unknown apps" for your browser or file manager when asked.
- Connect a USB keyboard with a USB-OTG adapter (USB-C to USB-A). Bluetooth MIDI keyboards show up once they're connected with a Bluetooth MIDI app.

## Building

```bash
npm install
npm run dev            # web version at http://localhost:5173 (Chrome or Edge, for Web MIDI)
npm test               # engine unit tests
npm run dist:win       # Windows zip (on any OS)
npm run dist:mac       # macOS zips (sign on a Mac for best results)
node scripts/prepareAndroid.mjs && cd android && ./gradlew assembleRelease   # Android APK (needs the Android SDK)
```

### Getting the APK without installing Android Studio
Push this folder to a GitHub repository. The workflow in `.github/workflows/build.yml` builds:
- the Android APK (Ubuntu runner with the Android SDK),
- the Windows installer and portable `.exe` (Windows runner),
- macOS `.dmg` files, ad-hoc signed (macOS runner).

Open the repository's **Actions** tab → latest run → **Artifacts** to download them. Push a tag such as `v1.0.0` and the files are attached to a GitHub Release.

To sign the APK with your own key (needed for the Play Store), add these repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is signed with a debug key, which is fine for sideloading.

## Architecture

```
src/engine/   midiParser → timeline (tempo map, measures, notes, sustain)
              transport (single clock) · waitEngine (matching) · session (controller)
              audio (Web Audio sampler + metronome) · midiIO (Web MIDI / Android native)
              stats · storage (IndexedDB) · demoSongs · midiWriter
src/render/   canvas renderer for falling notes and keyboard
src/ui/       React components
electron/     desktop shell (secure app:// origin, MIDI permission, file associations)
native/android/  Keystep's Android code (KeystepMidiPlugin.java MIDI bridge, manifest, icons);
              scripts/prepareAndroid.mjs generates the Capacitor project and applies it
tests/        unit tests (vitest) and end-to-end tests with a simulated MIDI keyboard
```

## Credits
Piano samples: FluidR3_GM by Frank Wen, CC BY 3.0, via gleitz/midi-js-soundfonts. Fonts: Inter and JetBrains Mono, SIL OFL.
