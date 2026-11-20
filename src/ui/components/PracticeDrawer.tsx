import type { Session, UiState, Mode, HandSel, OtherHand } from '../../engine/session';
import type { TrackRole } from '../../engine/timeline';
import { Icon } from '../icons';
import { Seg, Stepper, SwitchRow, pct } from '../controls';

const PRESETS = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];

const MODE_HELP: Record<Mode, string> = {
  wait: 'The song stops at each note until you play it. Chords need every note, in any order.',
  playalong: 'The song keeps time. Notes you play late or skip count as missed.',
  listen: 'Hear the whole song with the notes highlighted. Nothing to play.',
  free: 'Play anything. No judging, no waiting.',
};

export function PracticeDrawer({ session, ui, overlay, onClose }: { session: Session; ui: UiState; overlay: boolean; onClose: () => void }) {
  const s = ui.settings;
  const song = ui.song;
  const judged = s.mode === 'wait' || s.mode === 'playalong';
  const lastMeasure = song ? song.measures.length : 1;
  return (
    <aside className={`drawer ${overlay ? 'overlay' : ''}`} aria-label="Practice settings">
      <div className="drawer-head">
        <h2>Practice</h2>
        <div className="spacer" />
        <button className="icon-btn" aria-label="Close practice panel" onClick={onClose}><Icon.Close size={16} /></button>
      </div>
      <div className="drawer-body">
        <div className="section">
          <h3>Mode</h3>
          <Seg<Mode> label="Practice mode" value={s.mode} onChange={(mode) => session.update({ mode })} options={[
            { value: 'wait', label: 'Wait' }, { value: 'playalong', label: 'Play-along' }, { value: 'listen', label: 'Listen' }, { value: 'free', label: 'Free' },
          ]} />
          <p className="hint">{MODE_HELP[s.mode]}</p>
          <button className={`btn block ${ui.listenThrough ? 'primary' : ''}`} style={{ marginTop: 10 }} onClick={() => void session.listenFirst()} disabled={!ui.song}>
            <Icon.Headphones size={15} /> {ui.listenThrough ? 'Stop listening' : 'Listen to the whole song first'}
          </button>
        </div>

        <div className="section">
          <h3>Hands</h3>
          <Seg<HandSel> label="Hands to practise" value={s.hands} onChange={(hands) => session.update({ hands })} options={[
            { value: 'left', label: 'Left', cls: 'l' }, { value: 'both', label: 'Both' }, { value: 'right', label: 'Right', cls: 'r' },
          ]} />
          {s.hands !== 'both' && judged && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="lbl">Other hand</span>
              <div style={{ width: 170 }}>
                <Seg<OtherHand> label="Other hand" value={s.otherHand} onChange={(otherHand) => session.update({ otherHand })} options={[
                  { value: 'play', label: 'Play' }, { value: 'quiet', label: 'Quiet' }, { value: 'mute', label: 'Mute' },
                ]} />
              </div>
            </div>
          )}
          {judged && (
            <div className="row" style={{ marginTop: 6 }}>
              <span className="lbl">My part’s sound</span>
              <div style={{ width: 170 }}>
                <Seg label="Sound of my part" value={s.myPart} onChange={(myPart) => session.update({ myPart, hearMyPart: false })} options={[
                  { value: 'off', label: 'Off', title: 'Only the accompaniment plays; you make the sound' },
                  { value: 'quiet', label: 'Quiet', title: 'Your notes play softly as a guide' },
                  { value: 'full', label: 'Full', title: 'Your notes play at full volume' },
                ]} />
              </div>
            </div>
          )}
          {judged && <p className="hint">{s.myPart === 'off' ? 'In Wait mode you hear the backing; your keyboard makes your notes.' : s.mode === 'wait' ? 'The app plays your notes when you reach them, so you hear how the music should sound.' : 'The app plays your notes along with the song.'}</p>}
        </div>

        <div className="section">
          <h3>Tempo <span className="mono" style={{ color: 'var(--text-1)' }}>{pct(s.speed)}</span></h3>
          <input type="range" aria-label="Speed" min={0.1} max={1.5} step={0.01} value={s.speed} onChange={(e) => session.setSpeed(Number(e.target.value))} style={{ width: '100%' }} />
          <div className="presets">
            {PRESETS.map((p) => <button key={p} className={Math.abs(s.speed - p) < 0.001 ? 'on' : ''} onClick={() => session.setSpeed(p)}>{Math.round(p * 100)}</button>)}
          </div>
          <SwitchRow label="Metronome" checked={s.metronome} onChange={(metronome) => session.update({ metronome })} />
          <SwitchRow label="Count-in (one measure)" checked={s.countIn} onChange={(countIn) => session.update({ countIn })} />
        </div>

        <div className="section">
          <h3>
            Loop section
            <span className="switch"><input type="checkbox" aria-label="Loop enabled" checked={ui.loop.enabled} onChange={(e) => session.setLoop({ enabled: e.target.checked })} /><span /></span>
          </h3>
          <div className="row"><span className="lbl">From measure</span><Stepper label="loop start" value={ui.loop.startMeasure + 1} min={1} max={lastMeasure} onChange={(v) => session.setLoop({ startMeasure: v - 1, endMeasure: Math.max(v - 1, ui.loop.endMeasure) })} /></div>
          <div className="row"><span className="lbl">To measure</span><Stepper label="loop end" value={ui.loop.endMeasure + 1} min={1} max={lastMeasure} onChange={(v) => session.setLoop({ endMeasure: v - 1, startMeasure: Math.min(v - 1, ui.loop.startMeasure) })} /></div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn sm" onClick={() => session.loopCurrentMeasure()}>Loop this measure</button>
            <button className="btn sm ghost" onClick={() => session.setLoop({ enabled: true, endMeasure: ui.loop.startMeasure + 3 })}>4 bars</button>
          </div>
          {ui.loop.enabled && ui.stats.loops > 0 && <p className="hint">{ui.stats.loops} repeats · {ui.stats.cleanLoops} without mistakes</p>}
          <p className="hint">Drag the loop edges on the timeline, or Shift-drag on it to draw a new loop.</p>
        </div>

        {song && (
          <div className="section">
            <h3>Tracks</h3>
            {song.tracks.map((t, i) => {
              const role = ui.roles[i];
              const color = role === 'right' ? 'var(--right)' : role === 'left' ? 'var(--left)' : role === 'split' ? 'linear-gradient(var(--right), var(--left))' : role === 'mute' ? 'var(--bg-4)' : 'var(--text-3)';
              return (
                <div className="track" key={i}>
                  <div className="track-top">
                    <span className="track-swatch" style={{ background: color }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="track-name" title={t.name}>{t.name}</div>
                      <div className="track-sub">{t.instrument} · {t.noteCount} notes</div>
                    </div>
                  </div>
                  <Seg<TrackRole> label={`Role of ${t.name}`} value={role} onChange={(r) => session.setRole(i, r)} options={[
                    { value: 'right', label: 'R', cls: 'r', title: 'Right hand' },
                    { value: 'left', label: 'L', cls: 'l', title: 'Left hand' },
                    { value: 'split', label: 'R+L', title: 'Both hands, split at middle C' },
                    { value: 'accompany', label: 'Backing', title: 'Accompaniment: plays, not practised' },
                    { value: 'mute', label: 'Mute', title: 'Silent and dimmed' },
                  ]} />
                  {role !== 'mute' && (
                    <div className="track-vol">
                      <Icon.Volume size={14} />
                      <input type="range" aria-label={`${t.name} volume`} min={0} max={1.5} step={0.05} value={ui.trackVolumes[i]} onChange={(e) => session.setTrackVolume(i, Number(e.target.value))} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {judged && (
          <div className="section">
            <h3>Note matching</h3>
            <div className="row"><span className="lbl">Chords</span>
              <div style={{ width: 170 }}><Seg label="Chord policy" value={s.chordPolicy} onChange={(chordPolicy) => session.update({ chordPolicy })} options={[{ value: 'all', label: 'All notes' }, { value: 'any', label: 'Any note' }]} /></div>
            </div>
            <div className="row"><span className="lbl">Chord roll limit</span>
              <select aria-label="Chord roll limit" value={s.rollWindowMs} onChange={(e) => session.update({ rollWindowMs: Number(e.target.value) })}>
                <option value={0}>Off</option><option value={300}>300 ms</option><option value={600}>600 ms</option><option value={1000}>1 s</option>
              </select>
            </div>
            <div className="row"><span className="lbl">Timing tolerance</span>
              <Stepper label="tolerance" value={s.toleranceMs} min={50} max={600} step={25} onChange={(toleranceMs) => session.update({ toleranceMs })} format={(v) => `${v}ms`} />
            </div>
            <SwitchRow label="Accept any octave" checked={s.octaveAgnostic} onChange={(octaveAgnostic) => session.update({ octaveAgnostic })} />
            <SwitchRow label="Only notes my keyboard has" checked={s.limitRange} onChange={(limitRange) => session.update({ limitRange })} hint={s.limitRange ? 'Set your keyboard range in Settings → Input.' : undefined} />
          </div>
        )}
      </div>
    </aside>
  );
}
