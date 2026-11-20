import { isBlackKey } from '../engine/gm';
import type { Song } from '../engine/timeline';

export interface KeyRect { pitch: number; x: number; w: number; black: boolean }

export interface KeyboardLayout {
  low: number;
  high: number;
  keys: Map<number, KeyRect>;
  whiteW: number;
  width: number;
}

// Black-key centre offsets relative to the boundary between white keys (in white-key widths).
const BLACK_OFFSET: Record<number, number> = { 1: -0.08, 3: 0.08, 6: -0.1, 8: 0, 10: 0.1 };

export function computeRange(mode: string, song: Song | null, transpose = 0): [number, number] {
  switch (mode) {
    case '88': return [21, 108];
    case '76': return [28, 103];
    case '61': return [36, 96];
    case '49': return [36, 84];
  }
  if (!song || !song.notes.length) return [36, 96];
  let lo = 127, hi = 0;
  for (const n of song.notes) {
    if (song.tracks[n.track]?.isDrum) continue;
    lo = Math.min(lo, n.pitch + transpose);
    hi = Math.max(hi, n.pitch + transpose);
  }
  if (lo > hi) return [36, 96];
  lo = Math.max(21, lo - 2);
  hi = Math.min(108, hi + 2);
  // Expand to whole octaves (C..B) and at least three octaves.
  lo = lo - (((lo % 12) + 12) % 12);
  hi = hi + (11 - (hi % 12));
  while (hi - lo + 1 < 36) { if (lo > 24) lo -= 12; if (hi - lo + 1 < 36 && hi < 107) hi += 12; if (lo <= 24 && hi >= 107) break; }
  return [Math.max(21, lo), Math.min(108, hi)];
}

export function layoutKeyboard(low: number, high: number, width: number): KeyboardLayout {
  // Ensure the edges are white keys.
  if (isBlackKey(low)) low--;
  if (isBlackKey(high)) high++;
  let whites = 0;
  for (let p = low; p <= high; p++) if (!isBlackKey(p)) whites++;
  const whiteW = width / whites;
  const keys = new Map<number, KeyRect>();
  let wi = 0;
  for (let p = low; p <= high; p++) {
    if (!isBlackKey(p)) {
      keys.set(p, { pitch: p, x: wi * whiteW, w: whiteW, black: false });
      wi++;
    } else {
      const bw = whiteW * 0.62;
      const center = wi * whiteW + (BLACK_OFFSET[p % 12] ?? 0) * whiteW;
      keys.set(p, { pitch: p, x: center - bw / 2, w: bw, black: true });
    }
  }
  return { low, high, keys, whiteW, width };
}

export function pitchAt(layout: KeyboardLayout, x: number, y: number, blackHeight: number): number | null {
  if (y <= blackHeight) {
    for (const k of layout.keys.values()) if (k.black && x >= k.x && x <= k.x + k.w) return k.pitch;
  }
  for (const k of layout.keys.values()) if (!k.black && x >= k.x && x < k.x + k.w) return k.pitch;
  return null;
}
