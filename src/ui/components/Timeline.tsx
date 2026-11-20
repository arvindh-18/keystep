import { useEffect, useRef } from 'react';
import type { Session, UiState } from '../../engine/session';
import { measureAt } from '../../engine/timeline';

// Measure ruler with playhead, loop region and draggable loop handles.
export function Timeline({ session, ui }: { session: Session; ui: UiState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.current!.clientWidth, h = wrap.current!.clientHeight;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const song = session.song;
      if (!song) return;
      const dur = song.duration;
      const X = (t: number) => (Math.max(0, t) / dur) * w;
      // density sparkline of notes
      const bins = Math.max(1, Math.floor(w / 3));
      const counts = new Array(bins).fill(0);
      for (const n of session.notes) counts[Math.min(bins - 1, Math.floor((n.start / dur) * bins))]++;
      const maxC = Math.max(1, ...counts);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      counts.forEach((c, i) => { const bh = (c / maxC) * (h - 10); ctx.fillRect(i * 3, h - bh, 2, bh); });
      // measure ticks
      const pxPerMeasure = w / song.measures.length;
      const every = pxPerMeasure > 26 ? 1 : pxPerMeasure > 12 ? 4 : pxPerMeasure > 5 ? 8 : 16;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      song.measures.forEach((m, i) => {
        if (i % every) return;
        const x = Math.round(X(m.start));
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, 0, 1, i % (every * 4) === 0 ? 9 : 5);
        if (i % (every * (pxPerMeasure * every > 30 ? 1 : 2)) === 0) { ctx.fillStyle = 'rgba(255,255,255,0.38)'; ctx.fillText(String(i + 1), x + 3, 2); }
      });
      // loop
      if (session.loop.enabled || dragging.current) {
        const lt = session.loopTimes()!;
        const x1 = X(lt.start), x2 = X(lt.end);
        ctx.fillStyle = session.loop.enabled ? 'rgba(139,124,246,0.22)' : 'rgba(139,124,246,0.10)';
        ctx.fillRect(x1, 0, x2 - x1, h);
        ctx.fillStyle = '#8B7CF6';
        ctx.fillRect(x1, 0, 2, h);
        ctx.fillRect(x2 - 2, 0, 2, h);
        ctx.fillRect(x1, h - 6, 6, 6);
        ctx.fillRect(x2 - 6, h - 6, 6, 6);
      }
      // playhead
      const px = X(session.transport.time);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, h - 2, px, 2);
      ctx.fillStyle = '#ECEAE6';
      ctx.fillRect(Math.round(px) - 1, 0, 2, h);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  const dragging = useRef<null | 'start' | 'end' | 'seek' | 'create'>(null);

  useEffect(() => {
    const el = wrap.current!;
    let anchorMeasure = 0;
    const timeAt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const song = session.song!;
      return Math.max(0, Math.min(song.duration, ((e.clientX - r.left) / r.width) * song.duration));
    };
    const down = (e: PointerEvent) => {
      const song = session.song;
      if (!song) return;
      el.setPointerCapture(e.pointerId);
      const t = timeAt(e);
      const r = el.getBoundingClientRect();
      const lt = session.loopTimes()!;
      const xs = ((lt.start / song.duration) * r.width), xe = ((lt.end / song.duration) * r.width);
      const x = e.clientX - r.left;
      const grab = e.pointerType === 'touch' ? 16 : 8;
      if (session.loop.enabled && Math.abs(x - xs) < grab) dragging.current = 'start';
      else if (session.loop.enabled && Math.abs(x - xe) < grab) dragging.current = 'end';
      else if (e.shiftKey || e.button === 2) { dragging.current = 'create'; anchorMeasure = measureAt(song, t); session.setLoop({ enabled: true, startMeasure: anchorMeasure, endMeasure: anchorMeasure }); }
      else { dragging.current = 'seek'; session.seek(snap(t)); }
    };
    const snap = (t: number) => {
      const song = session.song!;
      // Snap to measure starts within 1.5% of the width.
      const m = song.measures[measureAt(song, t)];
      return Math.abs(m.start - t) < song.duration * 0.015 ? m.start : t;
    };
    const move = (e: PointerEvent) => {
      const song = session.song;
      if (!song || !dragging.current) return;
      const t = timeAt(e);
      const mi = measureAt(song, t);
      if (dragging.current === 'seek') session.seek(snap(t));
      else if (dragging.current === 'start') session.setLoop({ startMeasure: Math.min(mi, session.loop.endMeasure) });
      else if (dragging.current === 'end') session.setLoop({ endMeasure: Math.max(mi, session.loop.startMeasure) });
      else if (dragging.current === 'create') session.setLoop({ startMeasure: Math.min(anchorMeasure, mi), endMeasure: Math.max(anchorMeasure, mi) });
    };
    const up = () => { dragging.current = null; };
    const ctx = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('contextmenu', ctx);
    };
  }, [session]);

  return (
    <div className="timeline" ref={wrap} title="Click to seek · drag loop edges · Shift+drag to set a loop" aria-label="Song timeline">
      <canvas ref={ref} />
      {!ui.song && null}
    </div>
  );
}
