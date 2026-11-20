import { Fragment, useEffect, useState } from 'react';
import type { Session, UiState } from '../../engine/session';
import { noteName } from '../../engine/gm';
import { Icon } from '../icons';
import { safeFileName } from './RecordingsSheet';
import { SelectRow, SliderRow, Stepper, SwitchRow, pct } from '../controls';

type Tab = 'display' | 'audio' | 'input' | 'song' | 'shortcuts' | 'about';

export function SettingsSheet({ session, ui, onClose }: { session: Session; ui: UiState; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('display');
  const s = ui.settings;
  const up = session.update.bind(session);
  const [rangeCapture, setRangeCapture] = useState<null | 'low' | 'high'>(null);
  const [calib, setCalib] = useState<{ taps: number[]; beats: number[]; running: boolean } | null>(null);

  // "Press your lowest/highest key" capture.
  useEffect(() => {
    if (!rangeCapture) return;
    return session.midi.onMessage((m) => {
      if (m.type !== 'noteon') return;
      if (rangeCapture === 'low') up({ rangeLow: m.note, limitRange: true });
      else up({ rangeHigh: m.note, limitRange: true });
      setRangeCapture(null);
    });
  }, [rangeCapture, session, up]);

  // Latency calibration: tap along with 8 clicks; median offset becomes input latency.
  const startCalibration = async () => {
    await session.ensureAudio();
    const a = session.audio!;
    const start = a.now + 0.6;
    const beats = Array.from({ length: 8 }, (_, i) => start + i * 0.6);
    beats.forEach((b, i) => a.click(b, i % 4 === 0));
    setCalib({ taps: [], beats, running: true });
    setTimeout(() => setCalib((c) => (c ? { ...c, running: false } : c)), (0.6 * 9 + 0.6) * 1000);
  };
  useEffect(() => {
    if (!calib?.running) return;
    const onTap = () => {
      const a = session.audio;
      if (!a) return;
      setCalib((c) => (c ? { ...c, taps: [...c.taps, a.now] } : c));
    };
    const offMidi = session.midi.onMessage((m) => { if (m.type === 'noteon') onTap(); });
    const key = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); onTap(); } };
    window.addEventListener('keydown', key, true);
    return () => { offMidi(); window.removeEventListener('keydown', key, true); };
  }, [calib?.running, session]);
  const calibResult = (() => {
    if (!calib || calib.running || calib.taps.length < 4) return null;
    const offs = calib.taps.map((t) => {
      let best = Infinity;
      for (const b of calib.beats) if (Math.abs(t - b) < Math.abs(best)) best = t - b;
      return best;
    }).filter((o) => Math.abs(o) < 0.3).sort((a, b) => a - b);
    if (offs.length < 3) return null;
    return Math.round(offs[Math.floor(offs.length / 2)] * 1000);
  })();

  const exportMidi = () => {
    const bytes = session.exportMidi();
    if (!bytes) return;
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeFileName(`${ui.title}${s.transpose ? ` (${s.transpose > 0 ? '+' : ''}${s.transpose})` : ''}.mid`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Settings">
        <div className="sheet-head">
          <Icon.Settings />
          <h2>Settings</h2>
          <div className="spacer" />
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="sheet-tabs" role="tablist">
          {(['display', 'audio', 'input', 'song', 'shortcuts', 'about'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {{ display: 'Display', audio: 'Audio', input: 'Input', song: 'Song', shortcuts: 'Shortcuts', about: 'About' }[t]}
            </button>
          ))}
        </div>
        <div className="sheet-body">
          {tab === 'display' && (
            <>
              <div className="section">
                <h3>Falling notes</h3>
                <SelectRow label="Note labels" value={s.noteLabels} onChange={(noteLabels) => up({ noteLabels })} options={[{ value: 'none', label: 'None' }, { value: 'name', label: 'Note name' }, { value: 'nameOctave', label: 'Name + octave' }]} />
                <SelectRow label="Note names" value={s.naming} onChange={(naming) => up({ naming })} options={[{ value: 'letter', label: 'C D E (sharps)' }, { value: 'letterFlat', label: 'C D E (flats)' }, { value: 'solfege', label: 'Do Re Mi' }]} />
                <SliderRow label="Note speed (zoom)" value={s.pixelsPerSecond} min={40} max={600} step={5} onChange={(pixelsPerSecond) => up({ pixelsPerSecond })} format={(v) => `${v}px/s`} />
                <div className="row"><span className="lbl">Right hand colour</span><input type="color" aria-label="Right hand colour" value={s.colorRight} onChange={(e) => up({ colorRight: e.target.value })} /></div>
                <div className="row"><span className="lbl">Left hand colour</span><input type="color" aria-label="Left hand colour" value={s.colorLeft} onChange={(e) => up({ colorLeft: e.target.value })} /></div>
                <SwitchRow label="Reduced effects (older devices)" checked={s.reducedEffects} onChange={(reducedEffects) => up({ reducedEffects })} />
              </div>
              <div className="section">
                <h3>Keyboard</h3>
                <SelectRow label="Visible keys" value={s.keyRange} onChange={(keyRange) => up({ keyRange })} options={[{ value: 'auto', label: 'Fit to song' }, { value: '88', label: '88 keys (A0–C8)' }, { value: '76', label: '76 keys' }, { value: '61', label: '61 keys (C2–C7)' }, { value: '49', label: '49 keys (C2–C6)' }]} />
                <SelectRow label="Key labels" value={s.keyLabels} onChange={(keyLabels) => up({ keyLabels })} options={[{ value: 'none', label: 'None' }, { value: 'c', label: 'C keys with octave' }, { value: 'all', label: 'All keys' }]} />
                <SwitchRow label="Show frequency of held notes" checked={s.showFrequency} onChange={(showFrequency) => up({ showFrequency })} />
              </div>
            </>
          )}
          {tab === 'audio' && (
            <>
              <div className="section">
                <h3>Volume</h3>
                <SliderRow label="Master" value={s.volMaster} min={0} max={1.2} step={0.01} onChange={(volMaster) => up({ volMaster })} format={pct} />
                <SliderRow label="Song" value={s.volSong} min={0} max={1.2} step={0.01} onChange={(volSong) => up({ volSong })} format={pct} />
                <SliderRow label="My playing" value={s.volInput} min={0} max={1.2} step={0.01} onChange={(volInput) => up({ volInput })} format={pct} />
                <SliderRow label="Metronome" value={s.volMetronome} min={0} max={1.2} step={0.01} onChange={(volMetronome) => up({ volMetronome })} format={pct} />
                <SliderRow label="Velocity response" value={s.velocityCurve} min={0} max={1} step={0.05} onChange={(velocityCurve) => up({ velocityCurve })} format={pct} />
              </div>
              <div className="section">
                <h3>Metronome</h3>
                <SelectRow label="Sound" value={s.metronomeSound} onChange={(metronomeSound) => { up({ metronomeSound }); void session.ensureAudio().then(() => session.audio?.click(session.audio.now + 0.02, true, metronomeSound)); }} options={[{ value: 'wood', label: 'Woodblock' }, { value: 'beep', label: 'Beep' }]} />
              </div>
              <p className="hint" style={{ padding: '0 14px' }}>Piano sound: FluidR3 GM acoustic grand (CC BY 3.0). Song playback can also go to your keyboard: MIDI devices → Output.</p>
            </>
          )}
          {tab === 'input' && (
            <>
              <div className="section">
                <h3>Computer keyboard</h3>
                <SwitchRow label="Use computer keyboard as piano" checked={s.qwertyPiano} onChange={(qwertyPiano) => up({ qwertyPiano })} hint="A S D F G H J K L ; = white keys, W E T Y U O P = black keys, Z / X = octave down / up." />
                <div className="row"><span className="lbl">Octave</span><Stepper label="octave" value={s.qwertyOctave} min={1} max={7} onChange={(qwertyOctave) => up({ qwertyOctave })} format={(v) => `C${v}`} /></div>
              </div>
              <div className="section">
                <h3>Latency</h3>
                <div className="row"><span className="lbl">Input latency compensation</span><Stepper label="latency" value={s.inputLatencyMs} min={-100} max={300} step={5} onChange={(inputLatencyMs) => up({ inputLatencyMs })} format={(v) => `${v}ms`} /></div>
                <p className="hint">Matters for Play-along timing. Calibrate: press Start, then tap any key (or Space) on each of the 8 clicks.</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <button className="btn sm" onClick={() => void startCalibration()} disabled={!!calib?.running}>{calib?.running ? `Tap along… ${calib.taps.length}/8` : 'Start calibration'}</button>
                  {calibResult !== null && <>
                    <span className="mono">{calibResult} ms</span>
                    <button className="btn sm primary" onClick={() => { up({ inputLatencyMs: Math.max(-100, Math.min(300, calibResult + Math.round((session.audio?.outputLatency ?? 0) * 1000))) }); setCalib(null); }}>Use it</button>
                  </>}
                  {calib && !calib.running && calibResult === null && <span className="hint" style={{ margin: 0 }}>Not enough taps. Try again.</span>}
                </div>
              </div>
              <div className="section">
                <h3>My keyboard’s range</h3>
                <SwitchRow label="Skip notes my keyboard doesn’t have" checked={s.limitRange} onChange={(limitRange) => up({ limitRange })} />
                <div className="row"><span className="lbl">Lowest key</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="mono">{noteName(s.rangeLow)}</span><Stepper label="lowest key" value={s.rangeLow} min={21} max={s.rangeHigh - 12} onChange={(rangeLow) => up({ rangeLow })} format={() => ''} /><button className="btn sm" onClick={() => setRangeCapture('low')}>{rangeCapture === 'low' ? 'Press it…' : 'Detect'}</button></span>
                </div>
                <div className="row"><span className="lbl">Highest key</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="mono">{noteName(s.rangeHigh)}</span><Stepper label="highest key" value={s.rangeHigh} min={s.rangeLow + 12} max={108} onChange={(rangeHigh) => up({ rangeHigh })} format={() => ''} /><button className="btn sm" onClick={() => setRangeCapture('high')}>{rangeCapture === 'high' ? 'Press it…' : 'Detect'}</button></span>
                </div>
              </div>
              <div className="section">
                <h3>Splitting one-track songs</h3>
                <div className="row"><span className="lbl">Split point (left hand below)</span><Stepper label="split point" value={s.splitPoint} min={36} max={84} onChange={(splitPoint) => up({ splitPoint })} format={(v) => noteName(v)} /></div>
                <div className="row"><span className="lbl">Chord grouping window</span><Stepper label="chord window" value={s.chordWindowMs} min={10} max={120} step={5} onChange={(chordWindowMs) => up({ chordWindowMs })} format={(v) => `${v}ms`} /></div>
              </div>
            </>
          )}
          {tab === 'song' && (
            <>
              <div className="section">
                <h3>Transpose</h3>
                <div className="row"><span className="lbl">Semitones</span><Stepper label="transpose" value={s.transpose} min={-12} max={12} onChange={(transpose) => up({ transpose })} format={(v) => (v > 0 ? `+${v}` : String(v))} /></div>
                <p className="hint">Shifts the falling notes, the sound and what you need to play.</p>
                <button className="btn sm" style={{ marginTop: 8 }} onClick={exportMidi} disabled={!ui.song}><Icon.Download size={14} /> Export as MIDI{s.transpose ? ' (transposed)' : ''}</button>
              </div>
              {ui.song && (
                <div className="section">
                  <h3>File information</h3>
                  <table className="history">
                    <tbody>
                      <tr><td>Title</td><td>{ui.song.title}</td></tr>
                      <tr><td>Format</td><td className="mono">SMF type {ui.song.format} · {ui.song.ticksPerBeat} ticks/beat</td></tr>
                      <tr><td>Length</td><td className="mono">{Math.floor(ui.song.duration / 60)}:{String(Math.floor(ui.song.duration % 60)).padStart(2, '0')} · {ui.song.measures.length} measures</td></tr>
                      <tr><td>Tempo</td><td className="mono">{ui.song.tempos.map((t) => Math.round(t.bpm)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8).join(' → ')} BPM{ui.song.tempos.length > 1 ? ` (${ui.song.tempos.length} changes)` : ''}</td></tr>
                      <tr><td>Time signature</td><td className="mono">{ui.song.timeSignatures.map((t) => `${t.numerator}/${t.denominator}`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</td></tr>
                      <tr><td>Key</td><td>{ui.song.keySignature ? keyName(ui.song.keySignature.key, ui.song.keySignature.scale) : '—'}</td></tr>
                      <tr><td>Notes</td><td className="mono">{ui.song.notes.length} in {ui.song.tracks.length} track{ui.song.tracks.length === 1 ? '' : 's'}</td></tr>
                      <tr><td>Sustain pedal</td><td className="mono">{ui.song.sustain.length} presses</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {tab === 'shortcuts' && (
            <div className="section">
              <div className="shortcuts">
                {[
                  ['Space', 'Play / pause'], ['Esc', 'Stop'], ['Home', 'Restart'], ['← / →', 'Previous / next measure'],
                  ['↑ / ↓', 'Faster / slower (5%)'], ['L', 'Loop on / off (when computer-keyboard piano is off)'], ['Shift + L', 'Loop this measure'],
                  ['Shift + M', 'Metronome'], ['Shift + R', 'Start / stop recording'], ['Backspace', 'Wait mode: step back one note'], ['Tab', 'Wait mode: skip note'],
                  ['1 – 4', 'Mode: Wait, Play-along, Listen, Free (with Shift)'], ['Ctrl + O', 'Open library'], ['Ctrl + scroll', 'Zoom the falling notes'],
                  ['A S D F …', 'Computer-keyboard piano'], ['Z / X', 'Computer-keyboard octave'],
                ].map(([k, d]) => <Fragment key={k}><span className="kbd">{k}</span><span>{d}</span></Fragment>)}
              </div>
            </div>
          )}
          {tab === 'about' && (
            <div className="section">
              <p><b>Keystep</b> 1.0 — MIDI piano practice. You set the pace; the song waits for you.</p>
              <p className="hint">Songs, settings and practice history are stored only on this device.</p>
              <p className="hint">Piano samples: FluidR3_GM by Frank Wen (CC BY 3.0), via gleitz/midi-js-soundfonts. Fonts: Inter and JetBrains Mono (SIL OFL).</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn sm danger" onClick={() => { if (confirm('Reset all settings to defaults?')) { void import('../../engine/storage').then(({ storage }) => storage.setKV('settings', null)).then(() => location.reload()); } }}>Reset settings</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function keyName(key: number, scale: number) {
  const majors = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const minors = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
  const i = key + 7;
  return scale ? `${minors[i] ?? '?'} minor` : `${majors[i] ?? '?'} major`;
}
