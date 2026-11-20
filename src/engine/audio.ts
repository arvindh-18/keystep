// Web Audio output: sampled piano (with a synth fallback), live input voices,
// metronome clicks. Scheduling decisions are made by the session; this module
// only plays sounds at the AudioContext times it is given.

interface Voice {
  src: AudioScheduledSourceNode[];
  gain: GainNode;
  end: number;
  pitch: number;
  live: boolean;
}

export type Bus = 'song' | 'input' | 'metronome';

export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private buses: Record<Bus, GainNode>;
  private samples = new Map<number, AudioBuffer>();
  private sampleKeys: number[] = [];
  private scheduled = new Set<Voice>();
  private live = new Map<number, Voice>();
  private sustainHeld = new Set<number>();
  pedalDown = false;
  samplesReady = false;
  velocityCurve = 0.75; // 0 = flat, 1 = full velocity dynamics

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(this.ctx.destination);
    const mk = (v: number) => { const g = this.ctx.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.buses = { song: mk(0.9), input: mk(0.9), metronome: mk(0.6) };
  }

  get now() { return this.ctx.currentTime; }
  /** Output latency in seconds (best effort). */
  get outputLatency() { return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0); }

  async resume() { if (this.ctx.state !== 'running') await this.ctx.resume(); }

  setVolume(bus: Bus | 'master', v: number) {
    const g = bus === 'master' ? this.master : this.buses[bus];
    g.gain.setTargetAtTime(Math.max(0, Math.min(v, 1.5)), this.ctx.currentTime, 0.02);
  }

  /** Load the piano samples (one zip of mp3s; falls back to the synth if unavailable). */
  async loadPiano(url = 'piano.zip') {
    try {
      const { unzipSync } = await import('fflate');
      const files = unzipSync(new Uint8Array(await (await fetch(url)).arrayBuffer()));
      await Promise.all(Object.entries(files).filter(([n]) => n.endsWith('.mp3')).map(async ([name, bytes]) => {
        const audio = await this.ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
        this.samples.set(Number(name.replace('.mp3', '')), audio);
      }));
      this.sampleKeys = [...this.samples.keys()].sort((a, b) => a - b);
      this.samplesReady = this.sampleKeys.length > 0;
    } catch (err) {
      console.warn('Piano samples unavailable, using synth', err);
      this.samplesReady = false;
    }
  }

  private nearestSample(pitch: number): number | null {
    if (!this.sampleKeys.length) return null;
    let best = this.sampleKeys[0];
    for (const k of this.sampleKeys) if (Math.abs(k - pitch) < Math.abs(best - pitch)) best = k;
    return best;
  }

  private velocityGain(velocity: number) {
    const v = Math.max(1, Math.min(127, velocity)) / 127;
    return (1 - this.velocityCurve) * 0.7 + this.velocityCurve * v ** 1.6;
  }

  private makeVoice(pitch: number, velocity: number, when: number, bus: Bus, gainScale: number): Voice {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const peak = this.velocityGain(velocity) * gainScale;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.004);
    gain.connect(this.buses[bus]);
    const srcs: AudioScheduledSourceNode[] = [];
    const key = this.nearestSample(pitch);
    if (key !== null) {
      const src = ctx.createBufferSource();
      src.buffer = this.samples.get(key)!;
      src.playbackRate.value = 2 ** ((pitch - key) / 12);
      src.connect(gain);
      src.start(when);
      srcs.push(src);
    } else {
      // Synth fallback: a few decaying partials.
      const f = 440 * 2 ** ((pitch - 69) / 12);
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, when);
      env.gain.setTargetAtTime(0.25, when + 0.01, 0.6);
      env.connect(gain);
      [[1, 0.6, 'triangle'], [2, 0.18, 'sine'], [3, 0.08, 'sine']].forEach(([mult, amp, type]) => {
        const o = ctx.createOscillator();
        o.type = type as OscillatorType;
        o.frequency.value = f * (mult as number);
        const g = ctx.createGain();
        g.gain.value = amp as number;
        o.connect(g).connect(env);
        o.start(when);
        srcs.push(o);
      });
    }
    return { src: srcs, gain, end: Infinity, pitch, live: false };
  }

  private releaseVoice(v: Voice, at: number, release = 0.18) {
    const t = Math.max(at, this.ctx.currentTime);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, release / 3);
    for (const s of v.src) { try { s.stop(t + release * 2); } catch { /* already stopped */ } }
    v.end = t + release * 2;
  }

  /** Schedule a complete note (song playback). */
  playNote(pitch: number, velocity: number, when: number, duration: number, bus: Bus = 'song', gainScale = 1) {
    const v = this.makeVoice(pitch, velocity, when, bus, gainScale);
    const off = when + Math.max(0.05, duration);
    v.gain.gain.setValueAtTime(this.velocityGain(velocity) * gainScale, when + 0.004);
    // Natural decay while held, then release.
    v.gain.gain.setTargetAtTime(this.velocityGain(velocity) * gainScale * 0.35, when + 0.05, 1.2);
    this.releaseVoice(v, off);
    this.scheduled.add(v);
    v.src[0].onended = () => this.scheduled.delete(v);
  }

  /** Stop every scheduled (not yet finished) song voice. */
  stopScheduled() {
    const t = this.ctx.currentTime;
    for (const v of this.scheduled) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.02);
      for (const s of v.src) { try { s.stop(t + 0.1); } catch { /* noop */ } }
    }
    this.scheduled.clear();
  }

  // ---- Live input monitoring ----
  liveNoteOn(pitch: number, velocity: number) {
    const existing = this.live.get(pitch);
    if (existing) this.releaseVoice(existing, this.ctx.currentTime, 0.05);
    const v = this.makeVoice(pitch, velocity, this.ctx.currentTime, 'input', 1);
    v.gain.gain.setTargetAtTime(this.velocityGain(velocity) * 0.3, this.ctx.currentTime + 0.05, 1.5);
    v.live = true;
    this.live.set(pitch, v);
    this.sustainHeld.delete(pitch);
  }

  liveNoteOff(pitch: number) {
    const v = this.live.get(pitch);
    if (!v) return;
    if (this.pedalDown) { this.sustainHeld.add(pitch); return; }
    this.releaseVoice(v, this.ctx.currentTime);
    this.live.delete(pitch);
  }

  setPedal(down: boolean) {
    this.pedalDown = down;
    if (!down) {
      for (const p of this.sustainHeld) {
        const v = this.live.get(p);
        if (v) { this.releaseVoice(v, this.ctx.currentTime, 0.3); this.live.delete(p); }
      }
      this.sustainHeld.clear();
    }
  }

  allLiveOff() {
    for (const v of this.live.values()) this.releaseVoice(v, this.ctx.currentTime, 0.05);
    this.live.clear();
    this.sustainHeld.clear();
  }

  /** Render notes offline with the same piano and return a 16-bit stereo WAV. */
  async renderWav(notes: { pitch: number; velocity: number; start: number; soundEnd: number }[], duration: number): Promise<Blob> {
    const sr = 44100;
    const len = Math.ceil((duration + 1.5) * sr);
    const off = new OfflineAudioContext(2, len, sr);
    const out = off.createGain();
    out.gain.value = 0.8;
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4;
    out.connect(comp).connect(off.destination);
    for (const n of notes) {
      const when = n.start;
      const peak = this.velocityGain(n.velocity);
      const g = off.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.004);
      g.gain.setTargetAtTime(peak * 0.35, when + 0.05, 1.2);
      const offAt = Math.max(when + 0.05, n.soundEnd);
      g.gain.setTargetAtTime(0, offAt, 0.06);
      g.connect(out);
      const key = this.nearestSample(n.pitch);
      if (key !== null) {
        const src = off.createBufferSource();
        src.buffer = this.samples.get(key)!;
        src.playbackRate.value = 2 ** ((n.pitch - key) / 12);
        src.connect(g);
        src.start(when);
        src.stop(offAt + 0.5);
      } else {
        const o = off.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12);
        o.connect(g);
        o.start(when);
        o.stop(offAt + 0.5);
      }
    }
    const buf = await off.startRendering();
    return encodeWav(buf);
  }

  // ---- Metronome ----
  click(when: number, accent: boolean, sound: 'wood' | 'beep' = 'wood') {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.buses.metronome);
    if (sound === 'beep') {
      const o = ctx.createOscillator();
      o.frequency.value = accent ? 1760 : 1320;
      o.connect(g);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
      o.start(when); o.stop(when + 0.08);
      return;
    }
    // Woodblock-like: filtered noise burst + short sine.
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = accent ? 2600 : 1900;
    bp.Q.value = 6;
    n.connect(bp).connect(g);
    const o = ctx.createOscillator();
    o.frequency.value = accent ? 1250 : 900;
    const og = ctx.createGain();
    og.gain.setValueAtTime(accent ? 0.35 : 0.22, when);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    o.connect(og).connect(g);
    g.gain.value = accent ? 1 : 0.7;
    n.start(when); o.start(when); o.stop(when + 0.05);
  }
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) data.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    o += 2;
  }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
