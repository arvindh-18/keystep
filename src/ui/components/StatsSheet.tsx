import { useEffect, useState } from 'react';
import type { Session, UiState } from '../../engine/session';
import { storage, type SessionRecord } from '../../engine/storage';
import { Icon } from '../icons';
import { fmtTime } from '../controls';

export function StatsSheet({ session, ui, onClose }: { session: Session; ui: UiState; onClose: () => void }) {
  const [history, setHistory] = useState<SessionRecord[]>([]);
  useEffect(() => { if (ui.songId) void storage.sessionsFor(ui.songId).then(setHistory); }, [ui.songId, ui.version]);
  const st = ui.stats;
  const song = ui.song;
  const per = session.stats.perMeasure;
  const maxErr = Math.max(1, ...[...per.values()].map((v) => v.wrong + v.missed));
  const best = history.reduce<SessionRecord | null>((b, r) => (r.hits + r.wrong + r.missed >= 20 && (!b || r.accuracy > b.accuracy) ? r : b), null);
  const weakest = [...per.entries()].map(([m, v]) => ({ m, e: v.wrong + v.missed })).filter((x) => x.e > 0).sort((a, b) => b.e - a.e).slice(0, 3);

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Practice statistics">
        <div className="sheet-head">
          <Icon.Chart />
          <h2>Practice — {ui.title}</h2>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => session.resetStats()}>New run</button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="sheet-body">
          <div className="stat-grid">
            <div className="stat-cell"><div className="num">{st.hits + st.wrong + st.missed ? `${Math.round(st.accuracy * 100)}%` : '—'}</div><div className="lbl">Accuracy</div></div>
            <div className="stat-cell"><div className="num c-good">{st.hits}</div><div className="lbl">Correct</div></div>
            <div className="stat-cell"><div className="num c-bad">{st.wrong}</div><div className="lbl">Wrong notes</div></div>
            <div className="stat-cell"><div className="num c-warn">{st.missed}</div><div className="lbl">Missed</div></div>
            <div className="stat-cell"><div className="num">{fmtTime(st.activeSeconds)}</div><div className="lbl">Practice time</div></div>
            <div className="stat-cell"><div className="num">{Math.round(ui.settings.speed * 100)}%</div><div className="lbl">Tempo</div></div>
            <div className="stat-cell"><div className="num">{st.bestStreak}</div><div className="lbl">Best streak</div></div>
            <div className="stat-cell"><div className="num">{st.loops ? `${st.cleanLoops}/${st.loops}` : '—'}</div><div className="lbl">Clean loops</div></div>
          </div>

          {song && (
            <div className="section">
              <h3>Mistakes by measure {weakest.length > 0 && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Most: {weakest.map((w) => `m.${w.m + 1}`).join(', ')}</span>}</h3>
              <div className="heat" role="img" aria-label="Mistakes per measure">
                {song.measures.map((m) => {
                  const v = per.get(m.index);
                  const e = v ? v.wrong + v.missed : 0;
                  const played = v ? v.hits + e > 0 : false;
                  const h = played ? 8 + (e / maxErr) * 48 : 4;
                  const color = !played ? 'var(--bg-4)' : e === 0 ? 'var(--good)' : e / maxErr > 0.5 ? 'var(--bad)' : 'var(--warn)';
                  return <i key={m.index} title={`Measure ${m.index + 1}: ${e} mistake${e === 1 ? '' : 's'}`} style={{ height: h, background: color, opacity: played ? 0.85 : 1 }} onClick={() => { session.setLoop({ enabled: true, startMeasure: m.index, endMeasure: m.index }); onClose(); }} />;
                })}
              </div>
              <p className="hint">Green = clean, amber/red = mistakes. Click a bar to loop that measure.</p>
            </div>
          )}

          <div className="section">
            <h3>History{best && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Best: {Math.round(best.accuracy * 100)}% at {Math.round(best.speed * 100)}%</span>}</h3>
            {history.length === 0 ? <p className="hint">Runs are saved here when you stop, finish or switch songs.</p> : (
              <>
                <Spark data={history.slice(-30).map((h) => h.accuracy)} />
                <table className="history" style={{ marginTop: 10 }}>
                  <thead><tr><th>Date</th><th>Mode</th><th>Hands</th><th>Tempo</th><th>Accuracy</th><th>Notes</th><th>Time</th></tr></thead>
                  <tbody>
                    {[...history].reverse().slice(0, 40).map((h) => (
                      <tr key={h.id}>
                        <td>{new Date(h.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {new Date(h.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{h.mode === 'playalong' ? 'Play-along' : h.mode[0].toUpperCase() + h.mode.slice(1)}{h.loop ? ` · m.${h.loop[0] + 1}–${h.loop[1] + 1}` : ''}</td>
                        <td>{h.hands}</td>
                        <td className="mono">{Math.round(h.speed * 100)}%</td>
                        <td className="mono">{Math.round(h.accuracy * 100)}%</td>
                        <td className="mono">{h.hits}/{h.hits + h.wrong + h.missed}</td>
                        <td className="mono">{fmtTime(h.activeSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 600, h = 60;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 4 - v * (h - 8)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Accuracy over recent runs" preserveAspectRatio="none">
      <line x1="0" x2={w} y1={h - 4 - 0.9 * (h - 8)} y2={h - 4 - 0.9 * (h - 8)} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" />
      <polyline points={pts} fill="none" stroke="#8B7CF6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
