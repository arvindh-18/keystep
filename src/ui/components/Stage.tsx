import { useEffect, useRef } from 'react';
import type { Session, UiState } from '../../engine/session';
import { RollRenderer } from '../../render/roll';
import { pitchAt } from '../../render/keyboardLayout';
import { noteName } from '../../engine/gm';

export function Stage({ session, ui, onOpenLibrary }: { session: Session; ui: UiState; onOpenLibrary: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<RollRenderer | null>(null);

  useEffect(() => {
    const r = new RollRenderer(canvas.current!, session);
    renderer.current = r;
    const ro = new ResizeObserver(() => {
      const el = wrap.current!;
      r.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(wrap.current!);
    r.start();
    return () => { ro.disconnect(); r.stop(); };
  }, [session]);

  // Pointer handling: keyboard area plays notes (multi-touch); roll area scrubs/zooms.
  useEffect(() => {
    const el = canvas.current!;
    const active = new Map<number, number | null>(); // pointerId -> pitch
    let drag: { id: number; y: number; t0: number; moved: boolean } | null = null;
    const pinch = new Map<number, number>(); // pointerId -> y
    let pinchStart: { dist: number; pps: number } | null = null;

    const local = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const geomPitch = (x: number, y: number) => {
      const g = renderer.current?.geom;
      if (!g || y < g.rollHeight) return undefined;
      return pitchAt(g.layout, x, y - g.rollHeight, g.blackHeight);
    };
    const velocityFor = (y: number) => {
      const g = renderer.current?.geom;
      if (!g) return 90;
      const rel = (y - g.rollHeight) / g.keyboardHeight; // lower on the key = louder
      return Math.round(55 + 60 * Math.min(1, Math.max(0, rel)));
    };

    const down = (e: PointerEvent) => {
      const { x, y } = local(e);
      const p = geomPitch(x, y);
      if (p !== undefined) {
        el.setPointerCapture(e.pointerId);
        active.set(e.pointerId, p);
        if (p !== null) session.noteOn(p, velocityFor(y), performance.now(), 'screen');
        e.preventDefault();
        return;
      }
      // Roll area
      pinch.set(e.pointerId, y);
      if (pinch.size === 2) {
        const ys = [...pinch.values()];
        pinchStart = { dist: Math.abs(ys[0] - ys[1]) || 1, pps: session.settings.pixelsPerSecond };
        drag = null;
        return;
      }
      el.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y, t0: session.transport.time, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (active.has(e.pointerId)) {
        const { x, y } = local(e);
        const p = geomPitch(x, y) ?? null;
        const prev = active.get(e.pointerId);
        if (p !== prev) {
          if (prev !== null && prev !== undefined) session.noteOff(prev, 'screen');
          if (p !== null) session.noteOn(p, velocityFor(y), performance.now(), 'screen');
          active.set(e.pointerId, p);
        }
        return;
      }
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, local(e).y);
      if (pinchStart && pinch.size === 2) {
        const ys = [...pinch.values()];
        const d = Math.abs(ys[0] - ys[1]) || 1;
        session.update({ pixelsPerSecond: Math.round(Math.max(40, Math.min(600, pinchStart.pps * (d / pinchStart.dist)))) });
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const dy = local(e).y - drag.y;
        if (Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved && !session.transport.playing) {
          session.seek(drag.t0 + dy / session.settings.pixelsPerSecond);
        }
      }
    };
    const up = (e: PointerEvent) => {
      if (active.has(e.pointerId)) {
        const p = active.get(e.pointerId);
        if (p !== null && p !== undefined) session.noteOff(p, 'screen');
        active.delete(e.pointerId);
        return;
      }
      pinch.delete(e.pointerId);
      if (pinch.size < 2) pinchStart = null;
      if (drag && drag.id === e.pointerId) {
        if (!drag.moved && e.type === 'pointerup' && e.pointerType !== 'mouse') void session.togglePlay();
        drag = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.01);
        session.update({ pixelsPerSecond: Math.round(Math.max(40, Math.min(600, session.settings.pixelsPerSecond * f))) });
      } else if (!session.transport.playing) {
        session.seek(session.transport.time - e.deltaY / session.settings.pixelsPerSecond);
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [session]);

  const pending = ui.playing && ui.settings.mode === 'wait' && ui.waiting ? session.match.pendingPitches() : [];

  return (
    <div className="stage" ref={wrap}>
      <canvas ref={canvas} aria-label="Falling notes and piano keyboard" role="img" />
      {!ui.song && (
        <div className="stage-msg" style={{ pointerEvents: 'auto' }}>
          <div className="t">No song loaded</div>
          <div className="s">Open a MIDI file to start practising.</div>
          <button className="btn primary" style={{ marginTop: 14 }} onClick={onOpenLibrary}>Open library</button>
        </div>
      )}
      {pending.length > 0 && (
        <div className="wait-tag" aria-live="polite">
          <span className="dot ok" /> Play {pending.map((p) => noteName(p, ui.settings.naming)).join(' + ')}
        </div>
      )}
    </div>
  );
}
