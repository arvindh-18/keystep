// Canvas renderer for the falling-note roll and the keyboard. Runs on
// requestAnimationFrame and reads session state directly (no React).

import type { Session } from '../engine/session';
import { measureAt } from '../engine/timeline';
import { isBlackKey, noteName, frequencyOf } from '../engine/gm';
import { computeRange, layoutKeyboard, type KeyboardLayout } from './keyboardLayout';

const C = {
  bg: '#0E0F11',
  laneBlack: 'rgba(255,255,255,0.025)',
  laneLine: 'rgba(255,255,255,0.035)',
  measure: 'rgba(255,255,255,0.13)',
  beat: 'rgba(255,255,255,0.045)',
  measureText: 'rgba(255,255,255,0.38)',
  loop: 'rgba(139,124,246,0.08)',
  loopEdge: 'rgba(139,124,246,0.55)',
  accompany: '#6B7280',
  hit: '#4ADE80',
  wrong: '#F25555',
  input: '#8B7CF6',
  white: '#E9E6DF',
  whiteShade: '#CFCBC2',
  black: '#17181B',
  blackTop: '#2A2C31',
  label: 'rgba(14,15,17,0.85)',
};

export interface RollGeometry {
  width: number;
  height: number;
  rollHeight: number;
  keyboardHeight: number;
  blackHeight: number;
  layout: KeyboardLayout;
}

export class RollRenderer {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private dpr = 1;
  geom: RollGeometry | null = null;
  private rangeKey = '';
  private maxDur = 4;
  private lastSong: unknown = null;
  private frameTimes: number[] = [];
  fps = 60;
  /** Extra time offset while the user drags the roll to scrub (seconds). */
  scrubOffset = 0;

  constructor(private canvas: HTMLCanvasElement, private session: Session) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  start() {
    const loop = (ts: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frameTimes.push(ts);
      if (this.frameTimes.length > 30) this.frameTimes.shift();
      if (this.frameTimes.length > 1) this.fps = (1000 * (this.frameTimes.length - 1)) / (ts - this.frameTimes[0]);
      this.session.tickLogic();
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); }

  resize(width: number, height: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.rangeKey = '';
  }

  private ensureGeometry() {
    const s = this.session;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    const key = `${width}x${height}:${s.settings.keyRange}:${s.settings.transpose}:${s.song?.title}:${s.song?.notes.length}`;
    if (key === this.rangeKey && this.geom) return this.geom;
    this.rangeKey = key;
    const [lo, hi] = computeRange(s.settings.keyRange, s.song, s.settings.transpose);
    const layout = layoutKeyboard(lo, hi, width);
    const portrait = height > width;
    const kbH = Math.round(Math.min(Math.max(height * (portrait ? 0.16 : 0.22), 70), layout.whiteW * 6.2, 220));
    this.geom = { width, height, rollHeight: height - kbH, keyboardHeight: kbH, blackHeight: kbH * 0.62, layout };
    return this.geom;
  }

  /** Convert a y position in the roll to song time. */
  timeAtY(y: number): number {
    const g = this.geom;
    if (!g) return 0;
    const pps = this.session.settings.pixelsPerSecond;
    return this.session.transport.time + (g.rollHeight - y) / pps;
  }

  private draw() {
    const s = this.session;
    const g = this.ensureGeometry();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, g.width, g.height);
    const song = s.song;
    if (song !== this.lastSong) {
      this.lastSong = song;
      this.maxDur = song ? Math.min(30, song.notes.reduce((m, n) => Math.max(m, n.soundEnd - n.start), 1)) : 4;
    }
    const t = s.transport.time + this.scrubOffset;
    const pps = s.settings.pixelsPerSecond;
    const H = g.rollHeight;
    const yOf = (time: number) => H - (time - t) * pps;
    const visibleSec = H / pps;
    const { layout } = g;
    const reduced = s.settings.reducedEffects;

    // Lanes behind black keys
    for (const k of layout.keys.values()) {
      if (k.black) { ctx.fillStyle = C.laneBlack; ctx.fillRect(k.x, 0, k.w, H); }
      else if (k.pitch % 12 === 0 || k.pitch % 12 === 5) { ctx.fillStyle = C.laneLine; ctx.fillRect(Math.round(k.x), 0, 1, H); }
    }

    if (song) {
      // Loop region
      if (s.loop.enabled) {
        const lt = s.loopTimes()!;
        const y1 = yOf(lt.end), y2 = yOf(lt.start);
        if (y2 > 0 && y1 < H) {
          ctx.fillStyle = C.loop;
          ctx.fillRect(0, Math.max(0, y1), g.width, Math.min(H, y2) - Math.max(0, y1));
          ctx.fillStyle = C.loopEdge;
          if (y1 >= 0) ctx.fillRect(0, y1, g.width, 1);
          if (y2 <= H) ctx.fillRect(0, y2, g.width, 1);
        }
      }
      // Measure and beat lines
      const m0 = measureAt(song, Math.max(0, t - 1));
      ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'bottom';
      for (let i = m0; i < song.measures.length; i++) {
        const m = song.measures[i];
        if (m.start > t + visibleSec + 0.1) break;
        for (let b = 1; b < m.beatTimes.length; b++) {
          const y = yOf(m.beatTimes[b]);
          if (y > 0 && y < H) { ctx.fillStyle = C.beat; ctx.fillRect(0, Math.round(y), g.width, 1); }
        }
        const y = yOf(m.start);
        if (y > -2 && y < H) {
          ctx.fillStyle = C.measure;
          ctx.fillRect(0, Math.round(y), g.width, 1);
          ctx.fillStyle = C.measureText;
          ctx.fillText(String(i + 1), 6, Math.round(y) - 3);
        }
      }

      // Notes
      const notes = s.notes;
      const current = s.match.current;
      const pending = new Set(s.match.pendingPitches());
      const currentIds = new Set(current ? current.notes.map((n) => n.id) : []);
      const nextGroup = s.match.groups[s.match.cursor + 1];
      const nextIds = new Set(nextGroup ? nextGroup.notes.map((n) => n.id) : []);
      const judged = s.settings.mode === 'wait' || s.settings.mode === 'playalong';
      let i = lowerBound(notes, t - this.maxDur - 0.5);
      const labels = s.settings.noteLabels;
      const naming = s.settings.naming;
      const rightC = s.settings.colorRight, leftC = s.settings.colorLeft;
      for (; i < notes.length; i++) {
        const n = notes[i];
        if (n.start > t + visibleSec) break;
        const k = layout.keys.get(n.pitch);
        if (!k) continue;
        const role = s.roles[n.track];
        if (role === 'mute' && song.tracks[n.track]?.isDrum) continue;
        const hand = s.hands[i];
        const required = s.isRequired(i);
        let color = hand === 'right' ? rightC : hand === 'left' ? leftC : C.accompany;
        let alpha = 1;
        if (role === 'mute') alpha = 0.12;
        else if (role === 'accompany') alpha = 0.32;
        else if (judged && !required) alpha = 0.35;
        const yTop = yOf(n.end), yBot = yOf(n.start);
        // Sustain tail
        if (n.soundEnd > n.end + 0.05 && !reduced) {
          const ys = yOf(n.soundEnd);
          ctx.globalAlpha = alpha * 0.28;
          ctx.fillStyle = color;
          ctx.fillRect(k.x + k.w / 2 - 1, ys, 2, yTop - ys);
        }
        const passed = n.end < t;
        if (passed) alpha *= 0.35;
        const isCurrent = currentIds.has(n.id);
        const done = isCurrent && !pending.has(n.pitch);
        if (done) color = C.hit;
        ctx.globalAlpha = alpha;
        const pad = k.black ? 0.5 : 1.5;
        const x = k.x + pad, w = k.w - pad * 2;
        const h = Math.max(4, yBot - yTop);
        roundRect(ctx, x, yBot - h, w, h, Math.min(4, w / 3));
        ctx.fillStyle = color;
        ctx.fill();
        if (!passed && alpha === 1) {
          // Subtle top highlight for depth
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = '#fff';
          ctx.fillRect(x + 1, yBot - h + 1, w - 2, Math.min(2, h - 2));
        }
        if ((isCurrent && !done) || nextIds.has(n.id)) {
          ctx.globalAlpha = isCurrent ? 1 : 0.5;
          ctx.lineWidth = isCurrent ? 2 : 1;
          ctx.strokeStyle = '#FFFFFF';
          roundRect(ctx, x - 1, yBot - h - 1, w + 2, h + 2, Math.min(5, w / 3));
          ctx.stroke();
        }
        if (labels !== 'none' && w >= 11 && h >= 14 && alpha > 0.3) {
          ctx.globalAlpha = Math.min(1, alpha + 0.2);
          ctx.fillStyle = C.label;
          ctx.font = `700 ${Math.min(11, Math.max(8, w * 0.42))}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const name = noteName(n.pitch, naming, labels === 'nameOctave');
          ctx.fillText(w < 18 ? name.replace(/\d$/, '') : name, x + w / 2, yBot - 3);
          ctx.textAlign = 'left';
        }
      }
      ctx.globalAlpha = 1;
    }

    // Hit line
    const waiting = s.transport.waiting;
    const pulse = waiting ? 0.55 + 0.45 * Math.sin(performance.now() / 180) : 0;
    const grad = ctx.createLinearGradient(0, H - 14, 0, H);
    grad.addColorStop(0, 'rgba(242,85,85,0)');
    grad.addColorStop(1, waiting ? `rgba(255,255,255,${0.10 + 0.12 * pulse})` : 'rgba(255,255,255,0.06)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 14, g.width, 14);
    ctx.fillStyle = waiting ? `rgba(255,255,255,${0.6 + 0.4 * pulse})` : 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, H - 2, g.width, 2);

    this.drawKeyboard(g, t);
    this.drawOverlays(g, t);
  }

  private drawKeyboard(g: RollGeometry, t: number) {
    const s = this.session;
    const ctx = this.ctx;
    const top = g.rollHeight;
    const kbH = g.keyboardHeight;
    const bh = g.blackHeight;
    const now = performance.now();
    const pending = new Set(s.match.pendingPitches());
    const judged = (s.settings.mode === 'wait' || s.settings.mode === 'playalong') && s.transport.playing;
    const waiting = s.transport.waiting;
    // Song notes sounding now
    const sounding = new Map<number, string>();
    if (s.song) {
      let i = lowerBound(s.notes, t - this.maxDur);
      for (; i < s.notes.length; i++) {
        const n = s.notes[i];
        if (n.start > t) break;
        if (n.end > t && s.roles[n.track] !== 'mute') {
          const hand = s.hands[i];
          sounding.set(n.pitch, hand === 'right' ? s.settings.colorRight : hand === 'left' ? s.settings.colorLeft : C.accompany);
        }
      }
    }
    const flashFor = (p: number) => {
      let f: (typeof s.flashes)[number] | null = null;
      for (const fl of s.flashes) if (fl.pitch === p && now - fl.at < 450 && (!f || fl.at > f.at)) f = fl;
      return f;
    };
    const fillFor = (p: number, base: string): { fill: string; mark?: string; depress: boolean } => {
      const held = s.held.has(p);
      const fl = flashFor(p);
      if (fl?.kind === 'wrong' && (held || now - fl.at < 250)) return { fill: C.wrong, depress: held };
      if (fl?.kind === 'hit' && (held || now - fl.at < 200)) return { fill: C.hit, depress: held };
      if (held) return { fill: C.input, depress: true };
      if (judged && pending.has(p)) {
        const hand = s.match.current?.notes.find((n) => n.pitch === p);
        const idx = hand ? hand.id : -1;
        const hc = idx >= 0 && s.hands[idx] === 'left' ? s.settings.colorLeft : s.settings.colorRight;
        return { fill: base, mark: hc, depress: false };
      }
      const snd = s.transport.playing ? sounding.get(p) : undefined;
      if (snd) return { fill: snd, depress: true };
      return { fill: base, depress: false };
    };

    ctx.fillStyle = '#050506';
    ctx.fillRect(0, top, g.width, kbH);
    const labelMode = s.settings.keyLabels;
    // White keys
    for (const k of g.layout.keys.values()) {
      if (k.black) continue;
      const st = fillFor(k.pitch, C.white);
      const y = top + (st.depress ? 2 : 0);
      ctx.fillStyle = st.fill;
      roundRectBottom(ctx, k.x + 0.5, y, k.w - 1, kbH - 2, 4);
      ctx.fill();
      if (st.fill === C.white) {
        const sh = ctx.createLinearGradient(0, y, 0, y + kbH);
        sh.addColorStop(0, 'rgba(0,0,0,0.18)');
        sh.addColorStop(0.08, 'rgba(0,0,0,0)');
        sh.addColorStop(0.92, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = sh;
        roundRectBottom(ctx, k.x + 0.5, y, k.w - 1, kbH - 2, 4);
        ctx.fill();
      }
      if (st.mark) {
        ctx.fillStyle = st.mark;
        ctx.globalAlpha = waiting ? 0.55 + 0.35 * Math.sin(now / 180) : 0.75;
        roundRectBottom(ctx, k.x + 3, top + kbH * 0.62, k.w - 6, kbH * 0.34, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const showLabel = labelMode === 'all' || (labelMode === 'c' && k.pitch % 12 === 0);
      if (showLabel && k.w > 9) {
        ctx.fillStyle = st.fill === C.white ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.6)';
        ctx.font = `600 ${Math.min(10, k.w * 0.45)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(k.pitch, s.settings.naming, labelMode === 'c' || k.w > 16).replace(/[♯♭]/, (m) => m), k.x + k.w / 2, top + kbH - 6);
        ctx.textAlign = 'left';
      }
    }
    // Black keys
    for (const k of g.layout.keys.values()) {
      if (!k.black) continue;
      const st = fillFor(k.pitch, C.black);
      const y = top + (st.depress ? 1.5 : 0);
      ctx.fillStyle = st.fill;
      roundRectBottom(ctx, k.x, y, k.w, bh, 3);
      ctx.fill();
      if (st.fill === C.black) {
        ctx.fillStyle = C.blackTop;
        roundRectBottom(ctx, k.x + k.w * 0.14, y, k.w * 0.72, bh * 0.9, 2);
        ctx.fill();
      }
      if (st.mark) {
        ctx.fillStyle = st.mark;
        ctx.globalAlpha = waiting ? 0.6 + 0.35 * Math.sin(now / 180) : 0.8;
        roundRectBottom(ctx, k.x + 2, y + bh * 0.55, k.w - 4, bh * 0.4, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (labelMode === 'all' && k.w > 12) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `600 ${Math.min(9, k.w * 0.4)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(noteName(k.pitch, s.settings.naming, false), k.x + k.w / 2, y + bh - 5);
        ctx.textAlign = 'left';
      }
    }
    // Felt strip
    ctx.fillStyle = '#3A1D1D';
    ctx.fillRect(0, top, g.width, 3);
  }

  private drawOverlays(g: RollGeometry, t: number) {
    const s = this.session;
    const ctx = this.ctx;
    // Count-in beat number
    const ci = s.countIn;
    if (ci && t < ci.end && s.transport.playing) {
      const beat = Math.floor((t - ci.start) / ci.beat) + 1;
      if (beat >= 1 && beat <= ci.beats) {
        const frac = ((t - ci.start) / ci.beat) % 1;
        ctx.globalAlpha = 1 - frac * 0.7;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 64px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(beat), g.width / 2, g.rollHeight * 0.42);
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.globalAlpha = 0.5;
        ctx.fillText('COUNT-IN', g.width / 2, g.rollHeight * 0.42 + 46);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
      }
    }
    // Held-note frequency readout
    if (s.settings.showFrequency && s.held.size) {
      const ps = [...s.held.keys()].sort((a, b) => a - b);
      const txt = ps.map((p) => `${noteName(p, s.settings.naming)} ${frequencyOf(p).toFixed(1)} Hz`).join('   ');
      ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(txt, g.width - 12, 10);
      ctx.textAlign = 'left';
    }
    void isBlackKey;
  }
}

function lowerBound(notes: { start: number }[], t: number) {
  let lo = 0, hi = notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].start < t) lo = mid + 1; else hi = mid; }
  return lo;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRectBottom(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.closePath();
}
