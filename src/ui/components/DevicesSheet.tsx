import { useEffect, useRef, useState } from 'react';
import type { Session, UiState } from '../../engine/session';
import { noteName } from '../../engine/gm';
import { Icon } from '../icons';
import { SwitchRow } from '../controls';

export function DevicesSheet({ session, ui, onClose }: { session: Session; ui: UiState; onClose: () => void }) {
  const inputs = ui.midiDevices.filter((d) => d.kind === 'input');
  const outputs = ui.midiDevices.filter((d) => d.kind === 'output' && d.connected);
  const s = ui.settings;
  const [log, setLog] = useState<string[]>([]);
  const [vel, setVel] = useState(0);
  const [pedal, setPedal] = useState(false);
  const logRef = useRef<string[]>([]);

  useEffect(() => session.midi.onMessage((m) => {
    let line = '';
    const dev = ui.midiDevices.find((d) => d.id === m.source)?.name ?? '';
    if (m.type === 'noteon') { line = `ON   ${noteName(m.note).padEnd(4)} vel ${String(m.velocity).padStart(3)}  ch ${m.channel + 1}`; setVel(m.velocity); }
    else if (m.type === 'noteoff') line = `OFF  ${noteName(m.note).padEnd(4)}          ch ${m.channel + 1}`;
    else { line = `CC ${m.controller} = ${m.value}  ch ${m.channel + 1}${m.controller === 64 ? '  (sustain)' : ''}`; if (m.controller === 64) setPedal(m.value >= 64); }
    logRef.current = [`${line}   ${dev}`, ...logRef.current].slice(0, 7);
    setLog(logRef.current);
  }), [session, ui.midiDevices]);

  const all = ui.selectedInputs === 'all';
  const statusText = {
    unsupported: 'MIDI isn’t available here',
    idle: 'Not started',
    requesting: 'Waiting for permission…',
    denied: 'MIDI access was blocked',
    ready: inputs.some((d) => d.connected) ? `${inputs.filter((d) => d.connected).length} input${inputs.filter((d) => d.connected).length === 1 ? '' : 's'} connected` : 'No keyboard connected',
  }[ui.midiStatus as 'ready'] ?? ui.midiStatus;
  const dotCls = ui.midiStatus === 'ready' ? (inputs.some((d) => d.connected) ? 'ok' : 'warn') : ui.midiStatus === 'denied' || ui.midiStatus === 'unsupported' ? 'bad' : '';

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet narrow" role="dialog" aria-label="MIDI devices">
        <div className="sheet-head">
          <Icon.Plug />
          <h2>MIDI devices</h2>
          <div className="spacer" />
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="sheet-body">
          <div className="dev-status">
            <span className={`dot ${dotCls}`} style={{ marginTop: 6 }} />
            <div style={{ flex: 1 }}>
              <div className="big">{statusText}</div>
              <div className="hint" style={{ marginTop: 2 }}>
                {ui.midiBackend === 'android' ? 'Android MIDI · USB keyboards via an OTG adapter. Bluetooth MIDI keyboards appear once connected with a Bluetooth MIDI app.' : ui.midiBackend === 'webmidi' ? 'Web MIDI · plug in a USB keyboard or MIDI interface; it appears here automatically.' : ''}
              </div>
            </div>
            {(ui.midiStatus === 'denied' || ui.midiStatus === 'idle') && <button className="btn sm" onClick={() => void session.midi.start()}>Retry</button>}
          </div>

          {ui.midiStatus === 'unsupported' && (
            <div className="notice">
              This browser has no Web MIDI support (Safari, iOS and Firefox for Android don’t have it). Use the Keystep desktop app for Windows or macOS, the Android app, or Chrome / Edge.
              You can still practise with the on-screen piano or your computer keyboard (A S D F … = white keys, W E T Y U = black keys, Z / X = octave).
            </div>
          )}
          {ui.midiStatus === 'denied' && <div className="notice">MIDI permission was refused{session.midi.error ? ` (${session.midi.error})` : ''}. Allow MIDI for this app in your browser or system settings, then press Retry.</div>}

          <div className="section">
            <h3>Input</h3>
            <div className="dev-list">
              <label className="dev">
                <input type="radio" name="inputs" checked={all} onChange={() => session.midi.setInputs('all')} />
                <span className="name">All connected inputs</span>
              </label>
              {inputs.map((d) => (
                <label className="dev" key={d.id} style={{ opacity: d.connected ? 1 : 0.5 }}>
                  <input type="checkbox" checked={!all && (ui.selectedInputs as string[]).includes(d.id)} onChange={(e) => {
                    const cur = all ? [] : (ui.selectedInputs as string[]);
                    const next = e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id);
                    session.midi.setInputs(next.length ? next : 'all');
                  }} />
                  <span className="name">{d.name}</span>
                  <span className="hint" style={{ margin: 0 }}>{d.connected ? d.manufacturer : 'disconnected'}</span>
                </label>
              ))}
              {!inputs.length && ui.midiStatus === 'ready' && <p className="hint">Plug in your keyboard by USB. On Android, use a USB-OTG adapter.</p>}
            </div>
          </div>

          <div className="section">
            <h3>Live input</h3>
            <div className="row" style={{ gap: 12 }}>
              <span className="lbl" style={{ width: 60 }}>Velocity</span>
              <div className="meter"><i style={{ width: `${(vel / 127) * 100}%` }} /></div>
              <span className="mono" style={{ width: 28, textAlign: 'right' }}>{vel}</span>
              <span className="pill" style={{ height: 24, color: pedal ? 'var(--good)' : 'var(--text-3)' }}><Icon.Pedal size={13} /> Pedal</span>
            </div>
            <div className="monitor" style={{ marginTop: 8 }} aria-live="off">
              {log.length ? log.map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.12, whiteSpace: 'pre' }}>{l}</div>) : <span style={{ color: 'var(--text-3)' }}>Play a key to test your connection.</span>}
            </div>
            <SwitchRow label="Play my keys through the app" checked={s.monitorInput} onChange={(monitorInput) => session.update({ monitorInput })} hint="Turn off if your keyboard has its own speakers." />
          </div>

          <div className="section">
            <h3>Output</h3>
            <div className="row">
              <span className="lbl">Send to</span>
              <select aria-label="MIDI output" value={ui.selectedOutput ?? ''} onChange={(e) => void session.midi.setOutput(e.target.value || null)} style={{ maxWidth: 240 }}>
                <option value="">None (app speakers)</option>
                {outputs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <SwitchRow label="Play the song on my keyboard" checked={s.midiOutPlayback} onChange={(midiOutPlayback) => session.update({ midiOutPlayback })} hint={!ui.selectedOutput ? 'Choose an output first.' : undefined} />
            <SwitchRow label="Light up the next keys" checked={s.lightHints} onChange={(lightHints) => session.update({ lightHints })} hint="For keyboards with key lights: sends very quiet notes on the hint channel." />
            {s.lightHints && (
              <div className="row"><span className="lbl">Hint channel</span>
                <select aria-label="Hint channel" value={s.hintChannel} onChange={(e) => session.update({ hintChannel: Number(e.target.value) })}>
                  {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>Channel {i + 1}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
