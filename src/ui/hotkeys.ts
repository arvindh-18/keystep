import { useEffect } from 'react';
import type { Session, Mode } from '../engine/session';

// Computer-keyboard piano: two rows like a piano (white keys on the home row).
const WHITE = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17];
const BLACK: Record<string, number> = { KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10, KeyO: 13, KeyP: 15 };

export function qwertyPitch(code: string, octave: number): number | null {
  const base = (octave + 1) * 12;
  const wi = WHITE.indexOf(code);
  if (wi >= 0) return base + WHITE_OFFSETS[wi];
  if (code in BLACK) return base + BLACK[code];
  return null;
}

export function useHotkeys(session: Session, sheetOpen: boolean, openLibrary: () => void) {
  useEffect(() => {
    const down = new Map<string, number>();
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color'].includes((t as HTMLInputElement).type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') { e.preventDefault(); openLibrary(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = session.settings;
      // Piano keys first (when enabled and no dialog is open)
      if (s.qwertyPiano && !sheetOpen && !e.shiftKey) {
        if (e.code === 'KeyZ') { session.update({ qwertyOctave: Math.max(1, s.qwertyOctave - 1) }); return; }
        if (e.code === 'KeyX') { session.update({ qwertyOctave: Math.min(7, s.qwertyOctave + 1) }); return; }
        const p = qwertyPitch(e.code, s.qwertyOctave);
        if (p !== null) {
          e.preventDefault();
          if (!e.repeat && !down.has(e.code)) { down.set(e.code, p); session.noteOn(p, 92, performance.now(), 'screen'); }
          return;
        }
      }
      if (sheetOpen && e.code !== 'Escape') return;
      switch (e.code) {
        case 'Space': e.preventDefault(); void session.togglePlay(); break;
        case 'Escape': if (!sheetOpen) session.stop(); break;
        case 'Home': e.preventDefault(); session.restart(); break;
        case 'ArrowLeft': e.preventDefault(); session.seekMeasure(-1); break;
        case 'ArrowRight': e.preventDefault(); session.seekMeasure(1); break;
        case 'ArrowUp': e.preventDefault(); session.setSpeed(s.speed + 0.05); break;
        case 'ArrowDown': e.preventDefault(); session.setSpeed(s.speed - 0.05); break;
        case 'Backspace': e.preventDefault(); if (s.mode === 'wait') session.stepBackGroup(); break;
        case 'Tab': if (s.mode === 'wait' && session.transport.playing) { e.preventDefault(); session.skipGroup(); } break;
        case 'KeyL': if (e.shiftKey) session.loopCurrentMeasure(); else if (!s.qwertyPiano) session.setLoop({ enabled: !session.loop.enabled }); break;
        case 'KeyR': if (e.shiftKey || !s.qwertyPiano) void session.toggleRecording(); break;
        case 'KeyM': if (e.shiftKey || !s.qwertyPiano) session.update({ metronome: !s.metronome }); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
          if (!e.shiftKey && s.qwertyPiano) break;
          const modes: Mode[] = ['wait', 'playalong', 'listen', 'free'];
          session.update({ mode: modes[Number(e.code.slice(5)) - 1] });
          break;
        }
        default: break;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const p = down.get(e.code);
      if (p !== undefined) { down.delete(e.code); session.noteOff(p, 'screen'); }
    };
    const blur = () => { for (const p of down.values()) session.noteOff(p, 'screen'); down.clear(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', blur); };
  }, [session, sheetOpen, openLibrary]);
}
