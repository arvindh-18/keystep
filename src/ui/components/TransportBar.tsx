import { useEffect, useRef } from 'react';
import type { Session, UiState } from '../../engine/session';
import { measureAt } from '../../engine/timeline';
import { Icon } from '../icons';
import { fmtTime } from '../controls';

function LiveReadout({ session }: { session: Session }) {
  const big = useRef<HTMLDivElement>(null);
  const small = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const song = session.song;
      if (!song) return;
      const t = session.transport.time;
      const mi = measureAt(song, Math.max(0, t));
      const m = song.measures[mi];
      let beat = 1;
      for (let b = 0; b < m.beatTimes.length; b++) if (m.beatTimes[b] <= t + 1e-6) beat = b + 1;
      const b1 = `${mi + 1}.${t < 0 ? 0 : beat}`;
      const s1 = `${fmtTime(t)} / ${fmtTime(song.duration)}`;
      const key = b1 + s1;
      if (key !== last) {
        last = key;
        if (big.current) big.current.textContent = b1;
        if (small.current) small.current.textContent = s1;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session]);
  return (
    <div className="readout" title="Measure.beat · time">
      <div className="big" ref={big}>1.1</div>
      <div className="small" ref={small}>0:00 / 0:00</div>
    </div>
  );
}

function tempoAt(tempos: { time: number; bpm: number }[], t: number) {
  let bpm = tempos[0]?.bpm ?? 120;
  for (const tp of tempos) { if (tp.time <= Math.max(0, t) + 1e-6) bpm = tp.bpm; else break; }
  return bpm;
}

function RecTimer({ session }: { session: Session }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) ref.current.textContent = `${fmtTime(session.recorder.elapsed)} · ${session.recorder.noteCount}`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session]);
  return <span ref={ref} className="mono">0:00 · 0</span>;
}

export function TransportBar({ session, ui, onStats }: { session: Session; ui: UiState; onStats: () => void }) {
  const s = ui.settings;
  const judged = s.mode === 'wait' || s.mode === 'playalong';
  const bpm = ui.song ? Math.round(tempoAt(ui.song.tempos, session.transport.time) * s.speed) : 0;
  return (
    <div className="transport" role="toolbar" aria-label="Playback controls">
      <div className="t-group">
        <button className="icon-btn hide-xs" title="Restart (Home)" aria-label="Restart" onClick={() => session.restart()}><Icon.Restart /></button>
        <button className="icon-btn" title="Previous measure (←)" aria-label="Previous measure" onClick={() => session.seekMeasure(-1)}><Icon.Prev /></button>
        <button className={`play-btn ${ui.waiting ? 'waiting' : ''}`} title="Play / pause (Space)" aria-label={ui.playing ? 'Pause' : 'Play'} onClick={() => void session.togglePlay()} disabled={!ui.song}>
          {ui.playing ? <Icon.Pause size={20} /> : <Icon.Play size={20} />}
        </button>
        <button className="icon-btn" title="Next measure (→)" aria-label="Next measure" onClick={() => session.seekMeasure(1)}><Icon.Next /></button>
        <button className="icon-btn hide-xs" title="Stop (Esc)" aria-label="Stop" onClick={() => session.stop()}><Icon.Stop /></button>
      </div>
      <button className={`rec-btn ${ui.recording ? 'on' : ''}`} title="Record what you play (Shift+R)" aria-pressed={ui.recording} aria-label={ui.recording ? 'Stop recording' : 'Record'} onClick={() => void session.toggleRecording()}>
        <Icon.Record size={14} />
        {ui.recording ? <RecTimer session={session} /> : <span className="hide-xs">Rec</span>}
      </button>
      <LiveReadout session={session} />
      <div className="t-sep hide-xs" />
      <button className={`toggle-chip ${ui.listenThrough ? 'on' : ''}`} title="Listen to the whole song once, then practise" aria-pressed={ui.listenThrough} onClick={() => void session.listenFirst()} disabled={!ui.song}>
        <Icon.Headphones size={16} /><span className="hide-sm">{ui.listenThrough ? 'Listening…' : 'Listen'}</span>
      </button>
      <div className="speed" title="Playback speed (↑ / ↓)">
        <span className="val" aria-live="polite">{Math.round(s.speed * 100)}%</span>
        <span className="mono hide-sm" style={{ color: 'var(--text-3)', fontSize: 11 }}>{bpm} bpm</span>
        <button aria-label="Slower" onClick={() => session.setSpeed(s.speed - 0.05)}>−</button>
        <button aria-label="Faster" onClick={() => session.setSpeed(s.speed + 0.05)}>+</button>
      </div>
      <button className={`toggle-chip ${ui.loop.enabled ? 'on' : ''}`} title="Loop section (L)" aria-pressed={ui.loop.enabled} onClick={() => session.setLoop({ enabled: !ui.loop.enabled })}>
        <Icon.Loop size={16} /><span className="hide-xs">{ui.loop.enabled ? `${ui.loop.startMeasure + 1}–${ui.loop.endMeasure + 1}` : 'Loop'}</span>
      </button>
      <button className={`toggle-chip ${s.metronome ? 'on' : ''}`} title="Metronome (M)" aria-pressed={s.metronome} onClick={() => session.update({ metronome: !s.metronome })}>
        <Icon.Metronome size={16} /><span className="hide-sm">Click</span>
      </button>
      <button className={`toggle-chip hide-xs ${s.countIn ? 'on' : ''}`} title="Count-in before playing" aria-pressed={s.countIn} onClick={() => session.update({ countIn: !s.countIn })}>
        <span className="mono" style={{ fontSize: 11 }}>1·2·3·4</span>
      </button>
      {s.mode === 'wait' && (
        <div className="t-group hide-xs">
          <button className="icon-btn" title="Step back one note (Backspace)" aria-label="Step back one note" onClick={() => session.stepBackGroup()}><Icon.Undo size={16} /></button>
          <button className="icon-btn" title="Skip this note (Tab)" aria-label="Skip note" onClick={() => session.skipGroup()}><Icon.Skip size={16} /></button>
        </div>
      )}
      <div className="spacer" />
      {judged && (
        <button className="acc" onClick={onStats} title="Practice statistics" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
          <div className="stat"><span className="num">{ui.stats.hits + ui.stats.wrong + ui.stats.missed ? Math.round(ui.stats.accuracy * 100) + '%' : '—'}</span><span className="lbl">Accuracy</span></div>
          <div className="stat hide-xs"><span className="num c-good">{ui.stats.hits}</span><span className="lbl">Correct</span></div>
          <div className="stat hide-xs"><span className="num c-bad">{ui.stats.wrong}</span><span className="lbl">Wrong</span></div>
          {s.mode === 'playalong' && <div className="stat hide-xs"><span className="num c-warn">{ui.stats.missed}</span><span className="lbl">Missed</span></div>}
        </button>
      )}
      <div className="vol hide-sm" title="Master volume">
        <Icon.Volume size={16} />
        <input type="range" aria-label="Master volume" min={0} max={1.2} step={0.01} value={s.volMaster} onChange={(e) => session.update({ volMaster: Number(e.target.value) })} />
      </div>
    </div>
  );
}
