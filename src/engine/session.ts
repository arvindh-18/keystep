// Practice session controller: owns the song, transport, matching engine,
// audio scheduling, MIDI I/O, statistics and persistence. The UI subscribes to
// coarse state; the renderer reads live fields every animation frame.

import { parseMidi } from './midiParser';
import { buildSong, handOf, measureAt, type Note, type Song, type TrackRole, type Hand } from './timeline';
import { Transport } from './transport';
import { MatchEngine, defaultMatchOptions, type ChordPolicy, type NoteGroup } from './waitEngine';
import { AudioEngine } from './audio';
import { MidiIO, type MidiMessage } from './midiIO';
import { PracticeStats } from './stats';
import { storage, hashBytes, type SongPrefs, type StoredSong } from './storage';
import { demoSongs } from './demoSongs';
import { writeMidi } from './midiWriter';
import type { NoteNaming } from './gm';
import { Recorder, takeToMidi, takeToNotes, type Take } from './recorder';
import { fetchBytes, nameFromUrl } from './online';
import { collectMidi } from './bulkImport';

export type Mode = 'wait' | 'playalong' | 'listen' | 'free';
export type HandSel = 'both' | 'right' | 'left';
export type OtherHand = 'play' | 'quiet' | 'mute';

export interface Settings {
  mode: Mode;
  hands: HandSel;
  otherHand: OtherHand;
  hearMyPart: boolean;
  /** Sound of the notes you are practising: off, quiet guide, or full volume. */
  myPart: 'off' | 'quiet' | 'full';
  librarySort: 'name' | 'played' | 'added' | 'length';
  speed: number;
  metronome: boolean;
  metronomeSound: 'wood' | 'beep';
  countIn: boolean;
  transpose: number;
  splitPoint: number;
  chordPolicy: ChordPolicy;
  rollWindowMs: number;
  chordWindowMs: number;
  octaveAgnostic: boolean;
  toleranceMs: number;
  inputLatencyMs: number;
  limitRange: boolean;
  rangeLow: number;
  rangeHigh: number;
  volMaster: number;
  volSong: number;
  volInput: number;
  volMetronome: number;
  velocityCurve: number;
  monitorInput: boolean;
  midiOutPlayback: boolean;
  lightHints: boolean;
  hintChannel: number;
  noteLabels: 'none' | 'name' | 'nameOctave';
  naming: NoteNaming;
  keyLabels: 'none' | 'c' | 'all';
  keyRange: 'auto' | '88' | '76' | '61' | '49';
  pixelsPerSecond: number;
  reducedEffects: boolean;
  qwertyPiano: boolean;
  qwertyOctave: number;
  showFrequency: boolean;
  colorRight: string;
  colorLeft: string;
}

export const defaultSettings: Settings = {
  mode: 'wait', hands: 'both', otherHand: 'play', hearMyPart: false, myPart: 'off', librarySort: 'name', speed: 1,
  metronome: false, metronomeSound: 'wood', countIn: true, transpose: 0, splitPoint: 60,
  chordPolicy: 'all', rollWindowMs: 0, chordWindowMs: 30, octaveAgnostic: false, toleranceMs: 250,
  inputLatencyMs: 0, limitRange: false, rangeLow: 21, rangeHigh: 108,
  volMaster: 0.85, volSong: 0.9, volInput: 0.9, volMetronome: 0.6, velocityCurve: 0.75,
  monitorInput: true, midiOutPlayback: false, lightHints: false, hintChannel: 3,
  noteLabels: 'name', naming: 'letter', keyLabels: 'c', keyRange: 'auto', pixelsPerSecond: 160,
  reducedEffects: false, qwertyPiano: true, qwertyOctave: 4, showFrequency: false,
  colorRight: '#F2A33A', colorLeft: '#3FB6D9',
};

export interface LoopState { enabled: boolean; startMeasure: number; endMeasure: number }

export interface Flash { pitch: number; at: number; kind: 'hit' | 'wrong' }

export interface UiState {
  version: number;
  ready: boolean;
  songId: string | null;
  title: string;
  song: Song | null;
  playing: boolean;
  waiting: boolean;
  countingIn: boolean;
  loop: LoopState;
  roles: TrackRole[];
  trackVolumes: number[];
  settings: Settings;
  midiStatus: string;
  midiBackend: string;
  midiDevices: MidiIO['devices'];
  selectedInputs: 'all' | string[];
  selectedOutput: string | null;
  stats: { hits: number; wrong: number; missed: number; accuracy: number; streak: number; bestStreak: number; activeSeconds: number; loops: number; cleanLoops: number };
  library: StoredSong[];
  error: string | null;
  finished: boolean;
  previewing: string | null;
  listenThrough: boolean;
  notice: string | null;
  importProgress: { done: number; total: number } | null;
  recording: boolean;
  takes: Take[];
  playingTake: string | null;
  lastTake: Take | null;
}

const LOOKAHEAD = 0.12; // seconds of wall time scheduled ahead

export class Session {
  readonly transport: Transport;
  readonly match: MatchEngine;
  readonly midi = new MidiIO();
  audio: AudioEngine | null = null;
  stats = new PracticeStats();

  song: Song | null = null;
  notes: Note[] = []; // transposed song notes
  hands: (Hand | null)[] = [];
  required = new Uint8Array(0); // 1 if note is part of the user's practice
  songId: string | null = null;
  roles: TrackRole[] = [];
  trackVolumes: number[] = [];
  settings: Settings = { ...defaultSettings };
  loop: LoopState = { enabled: false, startMeasure: 0, endMeasure: 1 };
  library: StoredSong[] = [];
  error: string | null = null;
  notice: string | null = null;
  private preview: { id: string; timer: number; notes: { pitch: number; velocity: number; start: number; dur: number }[]; ptr: number; t0: number; end: number } | null = null;
  private listenRestore: { mode: Mode; countIn: boolean } | null = null;
  importProgress: { done: number; total: number } | null = null;
  finished = false;

  // Live state read by the renderer.
  held = new Map<number, number>(); // pitch -> velocity (input)
  heldSource = new Map<number, 'midi' | 'screen' | 'playback'>();
  readonly recorder = new Recorder();
  takes: Take[] = [];
  playingTake: string | null = null;
  lastTake: Take | null = null;
  private takeTimers: number[] = [];
  flashes: Flash[] = [];
  pedal = false;
  countIn: { start: number; end: number; beat: number; beats: number } | null = null;

  private scheduledUntil = 0;
  private schedPtr = 0;
  private timer: number | null = null;
  private listeners = new Set<() => void>();
  private snapshot: UiState | null = null;
  private version = 0;
  private lastWall = performance.now();
  private hinted = new Set<number>();
  private savedAttempted = 0;
  private prefsTimer: number | null = null;
  private uiTimer: number | null = null;
  private outNotes = new Map<number, number>(); // pitch -> off time for MIDI out

  constructor() {
    this.transport = new Transport(() => (this.audio ? this.audio.now : performance.now() / 1000));
    this.match = new MatchEngine({ ...defaultMatchOptions }, {
      onHit: (pitch, g) => { this.stats.hit(g.measure); this.flash(pitch, 'hit'); },
      onWrong: (pitch, g, measure) => { this.stats.wrongNote(g ? g.measure : measure); this.flash(pitch, 'wrong'); },
      onMissed: (_n, g) => { this.stats.miss(g.measure); },
      onGroupComplete: (g) => this.onGroupComplete(g),
    });
    this.transport.on((e) => this.onTransport(e));
    this.midi.onMessage((m) => this.onMidi(m));
    this.midi.onChange(() => { this.persistMidi(); this.changed(); });
  }

  // ---------- lifecycle ----------
  async init() {
    const saved = await storage.getKV<Partial<Settings>>('settings');
    if (saved) this.settings = { ...defaultSettings, ...saved };
    const midiPref = await storage.getKV<{ inputs?: string[]; output?: string | null }>('midi');
    if (midiPref) this.midi.restore(midiPref);
    await this.ensureDemoSongs();
    await this.backfillDurations();
    this.library = await storage.listSongs();
    this.takes = await storage.listTakes();
    this.applyMatchOptions();
    void this.midi.start();
    const lastId = await storage.getKV<string>('lastSong');
    const target = (lastId && this.library.find((s) => s.id === lastId)) || this.library.find((s) => s.id === 'demo-ode') || this.library[0];
    if (target) await this.openStored(target.id, false);
    this.timer = window.setInterval(() => this.schedule(), 25);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveSession(); });
    window.addEventListener('pagehide', () => this.saveSession());
    this.changed();
  }

  /** Must be called from a user gesture before audio can play. */
  async ensureAudio() {
    if (!this.audio) {
      const t = this.transport.time;
      this.audio = new AudioEngine();
      this.applyVolumes();
      // Re-anchor the transport on the new clock.
      this.transport.seek(t);
      void this.audio.loadPiano();
    }
    await this.audio.resume();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = (): UiState => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  private changed() {
    this.version++;
    this.snapshot = null;
    for (const l of this.listeners) l();
  }
  /** Coalesce frequent UI updates (stats during play) to ~8 per second. */
  private changedSoon() {
    if (this.uiTimer !== null) return;
    this.uiTimer = window.setTimeout(() => { this.uiTimer = null; this.changed(); }, 120);
  }

  private buildSnapshot(): UiState {
    const s = this.stats;
    return {
      version: this.version, ready: true, songId: this.songId, title: this.song?.title ?? '', song: this.song,
      playing: this.transport.playing, waiting: this.transport.waiting, countingIn: !!this.countIn && this.transport.time < this.countIn.end,
      loop: { ...this.loop }, roles: [...this.roles], trackVolumes: [...this.trackVolumes], settings: this.settings,
      midiStatus: this.midi.status, midiBackend: this.midi.backend, midiDevices: this.midi.devices, selectedInputs: this.midi.selectedInputs, selectedOutput: this.midi.selectedOutput,
      stats: { hits: s.hits, wrong: s.wrong, missed: s.missed, accuracy: s.accuracy, streak: s.streak, bestStreak: s.bestStreak, activeSeconds: s.activeSeconds, loops: s.loopsCompleted, cleanLoops: s.cleanLoops },
      library: this.library, error: this.error, finished: this.finished,
      previewing: this.preview?.id ?? null, listenThrough: this.listenRestore !== null,
      notice: this.notice, importProgress: this.importProgress ? { ...this.importProgress } : null,
      recording: this.recorder.recording, takes: this.takes, playingTake: this.playingTake, lastTake: this.lastTake,
    };
  }

  // ---------- library ----------
  private async ensureDemoSongs() {
    const existing = new Set((await storage.listSongs()).map((s) => s.id));
    for (const d of demoSongs) {
      if (existing.has(d.id)) continue;
      const bytes = d.make();
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await storage.putSong({ id: d.id, name: d.name, fileName: `${d.name}.mid`, bytes: buf, size: buf.byteLength, addedAt: 0, lastPlayedAt: 0, favorite: false, builtIn: true });
    }
  }

  /** Record length and note count for songs that don't have them yet (built-ins, older imports). */
  private async backfillDurations() {
    const missing = (await storage.listSongs()).filter((s) => !s.durationSec).slice(0, 500);
    for (const rec of missing) {
      try {
        const song = buildSong(parseMidi(rec.bytes), rec.name);
        rec.durationSec = song.duration;
        rec.noteCount = song.notes.length;
        await storage.putSong(rec);
      } catch { /* unreadable: leave as is */ }
    }
  }

  async importFile(file: File): Promise<boolean> {
    try {
      const buf = await file.arrayBuffer();
      return await this.importBytes(buf, file.name);
    } catch (e) {
      this.error = `Couldn't read ${file.name}: ${e instanceof Error ? e.message : e}`;
      this.changed();
      return false;
    }
  }

  async importBytes(buf: ArrayBuffer, fileName: string): Promise<boolean> {
    try {
      const song = buildSong(parseMidi(buf), prettyName(fileName));
      const id = await hashBytes(buf);
      const existing = await storage.getSong(id);
      await storage.putSong({
        id, name: existing?.name ?? song.title, fileName, bytes: buf, size: buf.byteLength,
        addedAt: existing?.addedAt ?? Date.now(), lastPlayedAt: Date.now(), favorite: existing?.favorite ?? false,
        durationSec: song.duration, noteCount: song.notes.length,
      });
      this.library = await storage.listSongs();
      await this.openStored(id, true);
      return true;
    } catch (e) {
      this.error = `${fileName} isn't a readable MIDI file (${e instanceof Error ? e.message : e}).`;
      this.changed();
      return false;
    }
  }

  /**
   * Import many files at once: MIDI files, zip archives and folder contents.
   * Songs are added to the library; a single song is opened right away.
   */
  async importMany(files: File[]): Promise<{ added: number; duplicates: number; failed: number }> {
    const res = { added: 0, duplicates: 0, failed: 0 };
    if (!files.length) return res;
    this.importProgress = { done: 0, total: 0 };
    this.notice = null;
    this.changed();
    let entries;
    let unreadable = 0;
    try {
      ({ entries, unreadable } = await collectMidi(files.filter((f) => /\.(mid|midi|kar|rmi|zip)$/i.test(f.name))));
    } catch (e) {
      this.importProgress = null;
      this.error = `Couldn't read the files: ${e instanceof Error ? e.message : e}`;
      this.changed();
      return res;
    }
    if (!entries.length) {
      this.importProgress = null;
      this.error = 'No MIDI files were found. Zip archives and folders must contain .mid or .midi files (RAR files need to be extracted first).';
      this.changed();
      return res;
    }
    res.failed += unreadable;
    this.importProgress = { done: 0, total: entries.length };
    this.changed();
    let firstId: string | null = null;
    const now = Date.now();
    for (let i = 0; i < entries.length; i++) {
      const { name, bytes } = entries[i];
      try {
        const song = buildSong(parseMidi(bytes), prettyName(name));
        if (!song.notes.length) throw new Error('no notes');
        const id = await hashBytes(bytes);
        const existing = await storage.getSong(id);
        if (existing) res.duplicates++;
        else {
          await storage.putSong({ id, name: song.title, fileName: name, bytes, size: bytes.byteLength, addedAt: now + i, lastPlayedAt: 0, favorite: false, durationSec: song.duration, noteCount: song.notes.length });
          res.added++;
          firstId ??= id;
        }
      } catch {
        res.failed++;
      }
      this.importProgress = { done: i + 1, total: entries.length };
      if (i % 10 === 0) this.changedSoon();
      // Yield so the UI stays responsive during big imports.
      if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
    }
    this.library = await storage.listSongs();
    this.importProgress = null;
    if (entries.length === 1 && firstId) {
      await this.openStored(firstId, true);
    } else {
      const parts = [`Added ${res.added} song${res.added === 1 ? '' : 's'} to your library`];
      if (res.duplicates) parts.push(`${res.duplicates} already there`);
      if (res.failed) parts.push(`${res.failed} unreadable`);
      this.notice = parts.join(' · ') + '.';
    }
    this.changed();
    return res;
  }

  // ---------- listen first / preview ----------
  /** Play the current song once from the start in Listen mode, then return to practice. */
  async listenFirst() {
    if (!this.song) return;
    if (this.listenRestore) { this.stopListenFirst(); return; }
    const prev = { mode: this.settings.mode === 'listen' ? 'wait' as Mode : this.settings.mode, countIn: this.settings.countIn };
    this.pause();
    this.update({ mode: 'listen', countIn: false });
    this.listenRestore = prev;
    this.seek(0);
    await this.play();
  }

  stopListenFirst() {
    const r = this.listenRestore;
    if (!r) return;
    this.listenRestore = null;
    this.pause();
    this.update({ mode: r.mode, countIn: r.countIn });
    this.changed();
  }

  /** Hear a library song without opening it (plays in the background). */
  async previewSong(id: string) {
    if (this.preview?.id === id) { this.stopPreview(); return; }
    this.stopPreview();
    const rec = await storage.getSong(id);
    if (!rec) return;
    let song: Song;
    try { song = buildSong(parseMidi(rec.bytes), rec.name); } catch { this.error = `Couldn't play ${rec.name}.`; this.changed(); return; }
    if (this.transport.playing) this.pause();
    this.stopTake();
    await this.ensureAudio();
    const a = this.audio!;
    const notes = song.notes.filter((n) => !song.tracks[n.track]?.isDrum).map((n) => ({ pitch: n.pitch, velocity: n.velocity, start: n.start, dur: n.soundEnd - n.start }));
    const t0 = a.now + 0.15 - (notes[0]?.start ?? 0) + Math.min(notes[0]?.start ?? 0, 0.3);
    const p = { id, timer: 0, notes, ptr: 0, t0, end: Math.max(...notes.map((n) => n.start + n.dur), 1) };
    // Schedule in small chunks so long songs don't create thousands of sounds at once.
    const pump = () => {
      if (this.preview !== p) return;
      const horizon = a.now - p.t0 + 0.6;
      while (p.ptr < p.notes.length && p.notes[p.ptr].start < horizon) {
        const n = p.notes[p.ptr++];
        a.playNote(n.pitch, n.velocity, p.t0 + n.start, n.dur, 'song', 0.9);
      }
      if (a.now - p.t0 > p.end + 0.5) { this.stopPreview(); }
    };
    p.timer = window.setInterval(pump, 100);
    this.preview = p;
    pump();
    this.changed();
  }

  stopPreview() {
    if (!this.preview) return;
    window.clearInterval(this.preview.timer);
    this.preview = null;
    this.audio?.stopScheduled();
    this.changed();
  }

  /** Seconds into the current preview (for the UI). */
  get previewElapsed(): number { return this.preview && this.audio ? Math.max(0, this.audio.now - this.preview.t0 - (this.preview.notes[0]?.start ?? 0)) : 0; }
  get previewDuration(): number { return this.preview ? this.preview.end - (this.preview.notes[0]?.start ?? 0) : 0; }

  dismissNotice() { this.notice = null; this.changed(); }

  /** Download a MIDI file from the internet and open it (it is saved to the library). */
  async importFromUrl(url: string, name?: string): Promise<boolean> {
    try {
      const buf = await fetchBytes(url.trim());
      const head = new Uint8Array(buf, 0, 4);
      if (head[0] === 0x50 && head[1] === 0x4b) {
        // A zip of MIDI files.
        const r = await this.importMany([new File([buf], nameFromUrl(url).replace(/\.mid$/i, '') + '.zip')]);
        return r.added + r.duplicates > 0;
      }
      const fileName = name ? (/\.(mid|midi|kar)$/i.test(name) ? name : `${name}.mid`) : nameFromUrl(url);
      return await this.importBytes(buf, fileName);
    } catch (e) {
      this.error = `Couldn't download the song: ${e instanceof Error ? e.message : e}`;
      this.changed();
      return false;
    }
  }

  async openStored(id: string, touch = true) {
    this.stopPreview();
    const rec = await storage.getSong(id);
    if (!rec) return;
    this.saveSession();
    try {
      const song = buildSong(parseMidi(rec.bytes), rec.name);
      const prefs = await storage.getPrefs(id);
      this.loadSong(song, id, prefs);
      if (touch || !rec.durationSec) {
        rec.lastPlayedAt = touch ? Date.now() : rec.lastPlayedAt;
        rec.durationSec = song.duration;
        rec.noteCount = song.notes.length;
        await storage.putSong(rec);
        this.library = await storage.listSongs();
      }
      await storage.setKV('lastSong', id);
      this.error = null;
    } catch (e) {
      this.error = `Couldn't open ${rec.name}: ${e instanceof Error ? e.message : e}`;
    }
    this.changed();
  }

  async deleteSong(id: string) {
    await storage.deleteSong(id);
    this.library = await storage.listSongs();
    if (this.songId === id) {
      this.transport.pause();
      const next = this.library[0];
      if (next) await this.openStored(next.id, false); else { this.song = null; this.songId = null; }
    }
    this.changed();
  }

  async toggleFavorite(id: string) {
    const rec = await storage.getSong(id);
    if (!rec) return;
    rec.favorite = !rec.favorite;
    await storage.putSong(rec);
    this.library = await storage.listSongs();
    this.changed();
  }

  async renameSong(id: string, name: string) {
    const rec = await storage.getSong(id);
    if (!rec || !name.trim()) return;
    rec.name = name.trim();
    await storage.putSong(rec);
    this.library = await storage.listSongs();
    if (this.songId === id && this.song) this.song.title = rec.name;
    this.changed();
  }

  loadSong(song: Song, id: string, prefs?: SongPrefs) {
    this.transport.pause();
    this.audio?.stopScheduled();
    this.song = song;
    this.songId = id;
    this.finished = false;
    this.roles = song.tracks.map((t, i) => (prefs?.roles?.[i] as TrackRole) ?? t.defaultRole);
    this.trackVolumes = song.tracks.map((_, i) => prefs?.trackVolumes?.[i] ?? 1);
    if (prefs?.speed) this.settings.speed = prefs.speed;
    if (prefs?.transpose !== undefined) this.settings.transpose = prefs.transpose;
    const lastMeasure = Math.max(0, song.measures.length - 1);
    this.loop = prefs?.loop
      ? { enabled: prefs.loop.enabled, startMeasure: Math.min(prefs.loop.startMeasure, lastMeasure), endMeasure: Math.min(prefs.loop.endMeasure, lastMeasure) }
      : { enabled: false, startMeasure: 0, endMeasure: Math.min(3, lastMeasure) };
    this.transport.duration = song.duration + 0.5;
    this.transport.setRate(this.settings.speed);
    this.stats = new PracticeStats();
    this.savedAttempted = 0;
    this.rebuildNotes();
    this.applyLoop();
    this.seek(this.loop.enabled ? song.measures[this.loop.startMeasure].start : firstNoteLeadIn(song));
  }

  // ---------- derived note data ----------
  rebuildNotes() {
    if (!this.song) return;
    const tr = this.settings.transpose;
    this.notes = this.song.notes.map((n) => (tr ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + tr)) } : n));
    this.hands = this.notes.map((n) => handOf(n, this.roles, this.settings.splitPoint + tr));
    this.required = new Uint8Array(this.notes.length);
    const s = this.settings;
    const judged = s.mode === 'wait' || s.mode === 'playalong';
    this.notes.forEach((n, i) => {
      const h = this.hands[i];
      if (!h || !judged) return;
      if (s.hands !== 'both' && s.hands !== h) return;
      if (s.limitRange && (n.pitch < s.rangeLow || n.pitch > s.rangeHigh)) return;
      this.required[i] = 1;
    });
    this.match.load(this.notes.filter((_, i) => this.required[i]), this.transport.time);
    this.resetScheduling();
  }

  isRequired(i: number) { return this.required[i] === 1; }

  // ---------- settings ----------
  update(patch: Partial<Settings>) {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    const s = this.settings;
    if (patch.speed !== undefined && patch.speed !== prev.speed) { this.transport.setRate(s.speed); this.schedulePrefs(); }
    if (['mode', 'hands', 'transpose', 'splitPoint', 'limitRange', 'rangeLow', 'rangeHigh', 'chordWindowMs'].some((k) => k in patch)) {
      this.applyMatchOptions();
      this.rebuildNotes();
      if (patch.transpose !== undefined) this.schedulePrefs();
    } else if (['chordPolicy', 'rollWindowMs', 'octaveAgnostic', 'toleranceMs'].some((k) => k in patch)) {
      this.applyMatchOptions();
    }
    if (['volMaster', 'volSong', 'volInput', 'volMetronome', 'velocityCurve'].some((k) => k in patch)) this.applyVolumes();
    if ('countIn' in patch) this.applyLoop();
    if ('lightHints' in patch && !s.lightHints) this.clearHints();
    if ('midiOutPlayback' in patch && !s.midiOutPlayback) this.midi.allNotesOff();
    if ('mode' in patch && this.transport.held) this.transport.release();
    void storage.setKV('settings', this.settings);
    this.changed();
  }

  private applyMatchOptions() {
    const s = this.settings;
    Object.assign(this.match.options, {
      chordWindow: s.chordWindowMs / 1000, chordPolicy: s.chordPolicy, rollWindowMs: s.rollWindowMs,
      octaveAgnostic: s.octaveAgnostic, earlyTolerance: s.toleranceMs / 1000, lateTolerance: s.toleranceMs / 1000,
      allowSkipAhead: s.mode === 'playalong',
    });
  }

  private applyVolumes() {
    const a = this.audio;
    if (!a) return;
    const s = this.settings;
    a.setVolume('master', s.volMaster);
    a.setVolume('song', s.volSong);
    a.setVolume('input', s.volInput);
    a.setVolume('metronome', s.volMetronome);
    a.velocityCurve = s.velocityCurve;
  }

  setRole(track: number, role: TrackRole) {
    this.roles[track] = role;
    this.rebuildNotes();
    this.schedulePrefs();
    this.changed();
  }

  setTrackVolume(track: number, v: number) {
    this.trackVolumes[track] = v;
    this.schedulePrefs();
    this.changed();
  }

  // ---------- loop ----------
  setLoop(patch: Partial<LoopState>) {
    if (!this.song) return;
    const last = this.song.measures.length - 1;
    const next = { ...this.loop, ...patch };
    next.startMeasure = clamp(Math.round(next.startMeasure), 0, last);
    next.endMeasure = clamp(Math.round(next.endMeasure), next.startMeasure, last);
    const wasEnabled = this.loop.enabled;
    this.loop = next;
    this.applyLoop();
    if (next.enabled && !wasEnabled) {
      const t = this.transport.time;
      const { start, end } = this.loopTimes()!;
      if (t < start - 0.01 || t >= end) this.seek(start);
    }
    this.schedulePrefs();
    this.changed();
  }

  loopTimes(): { start: number; end: number } | null {
    if (!this.song) return null;
    const m = this.song.measures;
    return { start: m[this.loop.startMeasure].start, end: m[this.loop.endMeasure].end };
  }

  private applyLoop() {
    if (!this.song || !this.loop.enabled) { this.transport.loop = null; return; }
    const lt = this.loopTimes()!;
    const ci = this.settings.countIn ? this.countInDuration(lt.start) : 0;
    this.transport.loop = { start: lt.start, end: lt.end, restartAt: lt.start - ci };
  }

  loopCurrentMeasure() {
    if (!this.song) return;
    const m = measureAt(this.song, Math.max(0, this.transport.time));
    this.setLoop({ enabled: true, startMeasure: m, endMeasure: m });
  }

  // ---------- transport ----------
  async play() {
    if (!this.song) return;
    await this.ensureAudio();
    this.stopTake();
    this.stopPreview();
    this.finished = false;
    let t = this.transport.time;
    if (t >= this.song.duration) t = this.loop.enabled ? this.loopTimes()!.start : 0;
    if (this.settings.countIn && this.settings.mode !== 'free') {
      const d = this.countInDuration(Math.max(0, t));
      const m = this.song.measures[measureAt(this.song, Math.max(0, t))];
      this.countIn = { start: t - d, end: t, beat: d / m.numerator, beats: m.numerator };
      this.transport.seek(t - d);
      this.match.seek(t);
    } else {
      this.countIn = null;
    }
    this.resetScheduling();
    this.transport.play();
    this.tickLogic();
    this.schedule();
    this.changed();
  }

  pause() {
    this.transport.pause();
    this.countIn = null;
    this.audio?.stopScheduled();
    this.stopMidiOut();
    this.clearHints();
    this.changed();
  }

  async togglePlay() { if (this.transport.playing) this.pause(); else await this.play(); }

  stop() {
    if (this.listenRestore) { this.stopListenFirst(); }
    this.pause();
    this.saveSession();
    if (this.song) this.seek(this.loop.enabled ? this.loopTimes()!.start : firstNoteLeadIn(this.song));
  }

  restart() {
    if (!this.song) return;
    const wasPlaying = this.transport.playing;
    this.pause();
    this.seek(this.loop.enabled ? this.loopTimes()!.start : 0);
    if (wasPlaying) void this.play();
  }

  seek(t: number) {
    const target = this.song ? clamp(t, -2, this.song.duration) : 0;
    const playing = this.transport.playing;
    this.countIn = null;
    this.transport.seek(target);
    this.match.seek(target);
    this.resetScheduling();
    this.finished = false;
    if (!playing) this.changed(); else this.changedSoon();
  }

  seekMeasure(delta: number) {
    if (!this.song) return;
    const t = Math.max(0, this.transport.time);
    const cur = measureAt(this.song, t);
    const m = this.song.measures;
    // "Previous" goes to the start of the current measure when well into it.
    let target = cur + delta;
    if (delta < 0 && t - m[cur].start > 0.4) target = cur;
    target = clamp(target, 0, m.length - 1);
    this.seek(m[target].start);
  }

  setSpeed(speed: number) { this.update({ speed: clamp(Math.round(speed * 100) / 100, 0.1, 2) }); }

  /** Wait mode: skip the awaited group. */
  skipGroup() { this.match.skipCurrent(); this.transport.release(); this.changedSoon(); }
  /** Wait mode: step back one group and move the playhead there. */
  stepBackGroup() {
    this.match.stepBack();
    const g = this.match.current;
    if (g) { this.transport.seek(g.time - 0.6); this.resetScheduling(); }
    this.changedSoon();
  }

  private countInDuration(at: number) {
    if (!this.song) return 0;
    const m = this.song.measures[measureAt(this.song, Math.max(0, at))];
    const beatDur = m.beatTimes.length > 1 ? m.beatTimes[1] - m.beatTimes[0] : (m.end - m.start) / m.numerator;
    return beatDur * m.numerator;
  }

  private onTransport(e: string) {
    if (e === 'loop') {
      this.stats.loopWrapped();
      const lt = this.loopTimes();
      if (lt) {
        this.match.seek(lt.start);
        const ci = lt.start - (this.transport.loop?.restartAt ?? lt.start);
        const m = this.song!.measures[this.loop.startMeasure];
        this.countIn = ci > 0 ? { start: lt.start - ci, end: lt.start, beat: ci / m.numerator, beats: m.numerator } : null;
      }
      this.audio?.stopScheduled();
      this.stopMidiOut();
      this.resetScheduling();
      this.changedSoon();
    } else if (e === 'end') {
      if (this.listenRestore) {
        // "Listen first" finished: back to practice mode at the start.
        const r = this.listenRestore;
        this.listenRestore = null;
        this.update({ mode: r.mode, countIn: r.countIn });
        this.seek(this.loop.enabled ? this.loopTimes()!.start : firstNoteLeadIn(this.song!));
        this.notice = 'That was the whole song. Press Play when you’re ready to practise.';
        this.changed();
        return;
      }
      this.finished = true;
      this.stopMidiOut();
      this.clearHints();
      this.saveSession();
      this.changed();
    } else if (e === 'seek' || e === 'rate') {
      this.audio?.stopScheduled();
      this.stopMidiOut();
    }
  }

  private resetScheduling() {
    this.scheduledUntil = this.transport.time;
    this.schedPtr = lowerBound(this.notes, this.scheduledUntil);
  }

  /** Per-frame logic: wait holds, play-along misses, loop wrap, stats time. Called from rAF and the scheduler. */
  tickLogic() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastWall) / 1000);
    this.lastWall = now;
    const tr = this.transport;
    if (!this.song || !tr.playing) return;
    tr.tick();
    if (!tr.playing) return;
    const t = tr.time;
    const mode = this.settings.mode;
    if (mode === 'wait') {
      const g = this.match.current;
      const loopEnd = this.transport.loop?.end ?? Infinity;
      if (g && g.time < loopEnd - 1e-6) tr.holdAtTime(g.time);
      else tr.release();
    } else if (mode === 'playalong') {
      if (!this.countIn || t >= this.countIn.end) this.match.advanceTo(t);
    }
    this.stats.activeSeconds += dt; // time spent finding notes while waiting counts as practice
    if (this.countIn && t >= this.countIn.end + 0.05) { this.countIn = null; this.changedSoon(); }
    this.updateHints();
  }

  private onGroupComplete(_g: NoteGroup) {
    if (this.settings.mode === 'wait') this.transport.release();
    this.changedSoon();
  }

  // ---------- audio + MIDI out scheduling ----------
  private schedule() {
    this.tickLogic();
    const tr = this.transport;
    const a = this.audio;
    if (!this.song || !tr.playing || !a) return;
    const rate = tr.rate;
    const now = tr.time;
    let horizon = now + LOOKAHEAD * rate;
    const hold = tr.holdTime;
    if (hold !== null) horizon = Math.min(horizon, hold);
    if (tr.loop) horizon = Math.min(horizon, tr.loop.end);
    horizon = Math.min(horizon, this.song.duration + 0.5);
    if (horizon <= this.scheduledUntil) return;
    const from = this.scheduledUntil;
    const ctxNow = a.now;
    const s = this.settings;
    const ci = this.countIn;

    // Notes
    while (this.schedPtr < this.notes.length && this.notes[this.schedPtr].start < horizon) {
      const i = this.schedPtr++;
      const n = this.notes[i];
      if (n.start < from) continue;
      if (ci && n.start < ci.end - 1e-6) continue; // silent during count-in
      if (this.loop.enabled && tr.loop && n.start < tr.loop.start - 1e-6) continue;
      const gain = this.audibility(i);
      if (gain <= 0) continue;
      const when = Math.max(tr.songToClock(n.start), ctxNow);
      if (when < ctxNow - 0.03) continue;
      const end = this.loop.enabled && tr.loop ? Math.min(n.soundEnd, tr.loop.end) : n.soundEnd;
      const dur = Math.max(0.05, (end - n.start) / rate);
      if (s.midiOutPlayback && this.midi.selectedOutput) {
        const perf = performance.now() + (when - ctxNow) * 1000;
        const vel = Math.max(1, Math.min(127, Math.round(n.velocity * gain)));
        this.midi.send([0x90, n.pitch, vel], perf);
        this.midi.send([0x80, n.pitch, 0], perf + ((n.end - n.start) / rate) * 1000);
        this.outNotes.set(n.pitch, perf + ((n.end - n.start) / rate) * 1000);
      } else {
        a.playNote(n.pitch, n.velocity, when, dur, 'song', gain);
      }
    }

    // Metronome and count-in clicks
    if (s.metronome || ci) {
      for (const bt of this.beatsBetween(from, horizon)) {
        if (!s.metronome && !(ci && bt.time < ci.end - 1e-6)) continue;
        const when = tr.songToClock(bt.time);
        if (when >= ctxNow - 0.01) a.click(Math.max(when, ctxNow), bt.accent, s.metronomeSound);
      }
    }
    this.scheduledUntil = horizon;
  }

  private beatsBetween(from: number, to: number): { time: number; accent: boolean }[] {
    const out: { time: number; accent: boolean }[] = [];
    const ci = this.countIn;
    if (ci) {
      for (let k = 0; k < ci.beats; k++) {
        const t = ci.start + k * ci.beat;
        if (t >= from - 1e-9 && t < to) out.push({ time: t, accent: k === 0 });
      }
    }
    if (!this.song) return out;
    const ms = this.song.measures;
    let mi = measureAt(this.song, Math.max(0, from));
    for (; mi < ms.length && ms[mi].start < to; mi++) {
      ms[mi].beatTimes.forEach((bt, k) => {
        if (bt >= from - 1e-9 && bt < to && bt >= 0 && !(ci && bt < ci.end - 1e-6)) out.push({ time: bt, accent: k === 0 });
      });
    }
    return out;
  }

  private audibility(i: number): number {
    const n = this.notes[i];
    const role = this.roles[n.track];
    if (role === 'mute') return 0;
    const vol = this.trackVolumes[n.track] ?? 1;
    const s = this.settings;
    if (role === 'accompany') return vol;
    // Piano part (right/left/split)
    if (s.mode === 'listen' || s.mode === 'free') return vol;
    if (this.required[i]) return (s.myPart === 'full' ? 1 : s.myPart === 'quiet' || s.hearMyPart ? 0.35 : 0) * vol;
    return (s.otherHand === 'play' ? 1 : s.otherHand === 'quiet' ? 0.35 : 0) * vol;
  }

  private stopMidiOut() {
    if (!this.outNotes.size) return;
    for (const p of this.outNotes.keys()) this.midi.send([0x80, p, 0]);
    this.outNotes.clear();
    this.midi.send([0xb0, 123, 0]);
  }

  // ---------- light-up key hints ----------
  private updateHints() {
    const s = this.settings;
    if (!s.lightHints || !this.midi.selectedOutput) return;
    const want = new Set(this.transport.playing ? this.match.pendingPitches() : []);
    const ch = (s.hintChannel - 1) & 15;
    for (const p of this.hinted) if (!want.has(p)) { this.midi.send([0x80 | ch, p, 0]); this.hinted.delete(p); }
    for (const p of want) if (!this.hinted.has(p)) { this.midi.send([0x90 | ch, p, 1]); this.hinted.add(p); }
  }
  private clearHints() {
    const ch = (this.settings.hintChannel - 1) & 15;
    for (const p of this.hinted) this.midi.send([0x80 | ch, p, 0]);
    this.hinted.clear();
  }

  // ---------- input ----------
  private onMidi(m: MidiMessage) {
    if (m.type === 'noteon') this.noteOn(m.note, m.velocity, m.time, 'midi');
    else if (m.type === 'noteoff') this.noteOff(m.note, 'midi');
    else if (m.type === 'cc' && m.controller === 64) {
      this.pedal = m.value >= 64;
      this.recorder.setPedal(this.pedal, m.time);
      this.audio?.setPedal(this.pedal);
    }
  }

  /** Note input from any source. `perfTime` is a performance.now() timestamp. */
  noteOn(pitch: number, velocity: number, perfTime = performance.now(), source: 'midi' | 'screen' = 'screen') {
    this.recorder.noteOn(pitch, velocity, perfTime);
    this.held.set(pitch, velocity);
    this.heldSource.set(pitch, source);
    if (this.settings.monitorInput || source === 'screen') {
      if (this.audio) this.audio.liveNoteOn(pitch, velocity);
      else void this.ensureAudio().then(() => this.audio?.liveNoteOn(pitch, velocity));
    }
    const mode = this.settings.mode;
    if ((mode === 'wait' || mode === 'playalong') && this.transport.playing && this.song) {
      const ageSec = Math.max(0, (performance.now() - perfTime) / 1000) + this.settings.inputLatencyMs / 1000;
      const clockAt = (this.audio ? this.audio.now : performance.now() / 1000) - ageSec;
      const songTime = this.transport.clockToSong(clockAt);
      if (this.countIn && songTime < this.countIn.end - this.settings.toleranceMs / 1000) return;
      this.match.noteOn(pitch, songTime, perfTime);
      this.changedSoon();
    }
  }

  noteOff(pitch: number, _source: 'midi' | 'screen' = 'screen') {
    this.recorder.noteOff(pitch);
    this.held.delete(pitch);
    this.heldSource.delete(pitch);
    this.audio?.liveNoteOff(pitch);
  }

  setPedal(down: boolean) { this.pedal = down; this.recorder.setPedal(down); this.audio?.setPedal(down); }

  private flash(pitch: number, kind: Flash['kind']) {
    const now = performance.now();
    this.flashes.push({ pitch, at: now, kind });
    if (this.flashes.length > 64) this.flashes = this.flashes.filter((f) => now - f.at < 600);
  }

  // ---------- persistence ----------
  private schedulePrefs() {
    if (this.prefsTimer !== null) window.clearTimeout(this.prefsTimer);
    this.prefsTimer = window.setTimeout(() => {
      this.prefsTimer = null;
      if (!this.songId) return;
      void storage.putPrefs({ songId: this.songId, roles: this.roles, trackVolumes: this.trackVolumes, speed: this.settings.speed, transpose: this.settings.transpose, loop: { ...this.loop } });
    }, 400);
  }

  private persistMidi() { void storage.setKV('midi', this.midi.rememberedPrefs()); }

  saveSession() {
    const s = this.stats;
    if (!this.songId || !this.song || s.attempted - this.savedAttempted < 5) return;
    this.savedAttempted = s.attempted;
    void storage.addSession({
      songId: this.songId, songName: this.song.title, date: Date.now(), mode: this.settings.mode, hands: this.settings.hands,
      speed: this.settings.speed, hits: s.hits, wrong: s.wrong, missed: s.missed, accuracy: s.accuracy,
      activeSeconds: Math.round(s.activeSeconds), measureErrors: s.measureErrors(),
      loop: this.loop.enabled ? [this.loop.startMeasure, this.loop.endMeasure] : undefined,
    });
  }

  resetStats() { this.saveSession(); this.stats = new PracticeStats(); this.savedAttempted = 0; this.changed(); }

  /** Export the current song (with transpose applied) as a MIDI file. */
  exportMidi(): Uint8Array | null {
    if (!this.song) return null;
    const tpb = this.song.ticksPerBeat;
    const tracks = this.song.tracks.map((t, ti) => ({
      name: t.name, program: t.isDrum ? undefined : t.program, channel: t.channel,
      notes: this.notes.filter((n) => n.track === ti).map((n) => ({ tick: n.startTick, duration: n.endTick - n.startTick, pitch: t.isDrum ? this.song!.notes[n.id].pitch : n.pitch, velocity: n.velocity })),
    }));
    const meta = {
      name: this.song.title,
      tempos: this.song.tempos.map((tp) => ({ tick: tp.tick, bpm: tp.bpm })),
      timeSignatures: this.song.timeSignatures.map((ts) => ({ tick: ts.tick, numerator: ts.numerator, denominator: ts.denominator })),
    };
    return writeMidi([meta, ...tracks], tpb);
  }

  // ---------- recording ----------
  async startRecording() {
    await this.ensureAudio();
    this.stopTake();
    this.lastTake = null;
    this.recorder.start();
    this.changed();
  }

  async stopRecording(): Promise<Take | null> {
    const take = this.recorder.stop({ songId: this.songId, songName: this.song?.title });
    if (take) {
      await storage.putTake(take);
      this.takes = await storage.listTakes();
      this.lastTake = take;
    } else {
      this.error = 'Nothing was recorded. Play some notes while the red record button is on.';
    }
    this.changed();
    return take;
  }

  async toggleRecording() { if (this.recorder.recording) await this.stopRecording(); else await this.startRecording(); }

  async playTake(id: string) {
    const take = this.takes.find((t) => t.id === id);
    if (!take) return;
    if (this.transport.playing) this.pause();
    this.stopTake();
    await this.ensureAudio();
    const a = this.audio!;
    const t0 = a.now + 0.12;
    const wall0 = performance.now() + 120;
    for (const n of takeToNotes(take)) {
      a.playNote(n.pitch, n.velocity, t0 + n.start, n.soundEnd - n.start, 'input', 1);
      // Light up the keys in step with the sound.
      this.takeTimers.push(window.setTimeout(() => { this.held.set(n.pitch, n.velocity); this.heldSource.set(n.pitch, 'playback'); }, wall0 + n.start * 1000 - performance.now()));
      this.takeTimers.push(window.setTimeout(() => { if (this.heldSource.get(n.pitch) === 'playback') { this.held.delete(n.pitch); this.heldSource.delete(n.pitch); } }, wall0 + n.end * 1000 - performance.now()));
    }
    this.takeTimers.push(window.setTimeout(() => { this.playingTake = null; this.changed(); }, wall0 + take.duration * 1000 - performance.now()));
    this.playingTake = id;
    this.changed();
  }

  stopTake() {
    if (!this.playingTake && !this.takeTimers.length) return;
    for (const t of this.takeTimers) window.clearTimeout(t);
    this.takeTimers = [];
    this.audio?.stopScheduled();
    for (const [p, src] of [...this.heldSource]) if (src === 'playback') { this.held.delete(p); this.heldSource.delete(p); }
    this.playingTake = null;
    this.changed();
  }

  async renameTake(id: string, name: string) {
    const t = this.takes.find((x) => x.id === id);
    if (!t || !name.trim()) return;
    t.name = name.trim();
    await storage.putTake(t);
    this.takes = await storage.listTakes();
    this.changed();
  }

  async deleteTake(id: string) {
    if (this.playingTake === id) this.stopTake();
    await storage.deleteTake(id);
    this.takes = await storage.listTakes();
    if (this.lastTake?.id === id) this.lastTake = null;
    this.changed();
  }

  takeMidi(id: string): Uint8Array | null {
    const t = this.takes.find((x) => x.id === id);
    return t ? takeToMidi(t) : null;
  }

  async takeWav(id: string): Promise<Blob | null> {
    const t = this.takes.find((x) => x.id === id);
    if (!t) return null;
    await this.ensureAudio();
    return this.audio!.renderWav(takeToNotes(t), t.duration);
  }

  /** Load a take into the falling-notes view as a song (it is added to the library). */
  async openTakeAsSong(id: string) {
    const t = this.takes.find((x) => x.id === id);
    if (!t) return;
    this.stopTake();
    const bytes = takeToMidi(t);
    await this.importBytes(bytes.slice().buffer as ArrayBuffer, `${t.name}.mid`);
  }

  dismissLastTake() { this.lastTake = null; this.changed(); }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer);
  }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function lowerBound(notes: Note[], t: number) {
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start < t - 1e-9) lo = mid + 1; else hi = mid; }
  return lo;
}

function firstNoteLeadIn(song: Song) {
  const first = song.notes[0]?.start ?? 0;
  return first > 1.5 ? Math.max(0, first - 1) : 0;
}

function prettyName(fileName: string) {
  return fileName.replace(/\.(mid|midi|kar|rmi)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
