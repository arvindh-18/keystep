// The single musical clock. Song time is derived from an external monotonic
// clock (AudioContext.currentTime in the app, a fake clock in tests), so
// audio scheduling and rendering read exactly the same position.

export type ClockFn = () => number; // seconds, monotonic

export interface TransportListener {
  (event: 'play' | 'pause' | 'seek' | 'rate' | 'hold' | 'release' | 'loop' | 'end'): void;
}

export interface LoopRange { start: number; end: number; /** Where to jump on wrap (e.g. start minus a count-in). */ restartAt?: number }

export class Transport {
  private anchorClock = 0;
  private anchorSong = 0;
  private _playing = false;
  private _rate = 1;
  private holdAt: number | null = null; // wait mode freeze point
  private listeners = new Set<TransportListener>();
  loop: LoopRange | null = null;
  duration = 0;

  constructor(private clock: ClockFn) {}

  on(fn: TransportListener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: Parameters<TransportListener>[0]) { for (const l of this.listeners) l(e); }

  get playing() { return this._playing; }
  get rate() { return this._rate; }
  get held() { return this.holdAt !== null; }
  get holdTime(): number | null { return this.holdAt; }

  /** Current song position in seconds. */
  get time(): number {
    if (!this._playing) return this.anchorSong;
    const t = this.anchorSong + (this.clock() - this.anchorClock) * this._rate;
    if (this.holdAt !== null) return Math.min(t, this.holdAt);
    return t;
  }

  /** Convert a song time to the clock's time base (for audio scheduling). */
  songToClock(songTime: number): number {
    return this.anchorClock + (songTime - this.anchorSong) / this._rate;
  }

  /** Convert a clock time (e.g. a MIDI input timestamp mapped to the clock) to song time. */
  clockToSong(clockTime: number): number {
    if (!this._playing) return this.anchorSong;
    const t = this.anchorSong + (clockTime - this.anchorClock) * this._rate;
    return this.holdAt !== null ? Math.min(t, this.holdAt) : t;
  }

  private reanchor(song: number) {
    this.anchorSong = song;
    this.anchorClock = this.clock();
  }

  play() {
    if (this._playing) return;
    if (this.anchorSong >= this.duration && this.duration > 0) this.anchorSong = this.loop ? this.loop.start : 0;
    this.reanchor(this.anchorSong);
    this._playing = true;
    this.emit('play');
  }

  pause() {
    if (!this._playing) return;
    this.reanchor(this.time);
    this._playing = false;
    this.emit('pause');
  }

  toggle() { if (this._playing) this.pause(); else this.play(); }

  seek(t: number) {
    const clamped = Math.max(-10, Math.min(t, this.duration));
    this.holdAt = null;
    this.reanchor(clamped);
    this.emit('seek');
  }

  setRate(rate: number) {
    const r = Math.max(0.05, Math.min(rate, 4));
    const now = this.time;
    this._rate = r;
    this.reanchor(now);
    this.emit('rate');
  }

  /** Freeze song time at `t` (wait mode). Time keeps running up to t, then stops. */
  holdAtTime(t: number) {
    if (this.holdAt !== null && Math.abs(this.holdAt - t) < 1e-9) return;
    this.holdAt = t;
    this.emit('hold');
  }

  /** Release a hold. Time resumes from the frozen point; nothing is skipped. */
  release() {
    if (this.holdAt === null) return;
    const now = this.time;
    this.holdAt = null;
    this.reanchor(now);
    this.emit('release');
  }

  /** True when time has reached the hold point. */
  get waiting(): boolean {
    if (this.holdAt === null || !this._playing) return false;
    const raw = this.anchorSong + (this.clock() - this.anchorClock) * this._rate;
    return raw >= this.holdAt;
  }

  /** Called by the app loop: applies loop wrap and end-of-song. Returns true if a wrap happened. */
  tick(): boolean {
    if (!this._playing) return false;
    const t = this.time;
    if (this.loop && t >= this.loop.end) {
      this.holdAt = null;
      this.reanchor(this.loop.restartAt ?? this.loop.start);
      this.emit('loop');
      return true;
    }
    if (t >= this.duration) {
      this.reanchor(this.duration);
      this._playing = false;
      this.emit('end');
    }
    return false;
  }
}
