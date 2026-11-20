import { useState } from 'react';
import type { Session, UiState } from '../../engine/session';
import { Icon } from '../icons';
import { fmtTime } from '../controls';

export function safeFileName(name: string) {
  // Chromium rejects some characters (e.g. em dashes) in download names.
  return name.replace(/[\u2012-\u2015]/g, '-').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim() || 'Keystep';
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function RecordingsSheet({ session, ui, onClose }: { session: Session; ui: UiState; onClose: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const exportMidi = (id: string, name: string) => {
    const bytes = session.takeMidi(id);
    if (bytes) download(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'audio/midi' }), `${name}.mid`);
  };
  const exportWav = async (id: string, name: string) => {
    setBusy(id);
    try {
      const blob = await session.takeWav(id);
      if (blob) download(blob, `${name}.wav`);
    } finally { setBusy(null); }
  };

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Recordings">
        <div className="sheet-head">
          <Icon.Takes />
          <h2>Recordings</h2>
          <div className="spacer" />
          <button className={`rec-btn ${ui.recording ? 'on' : ''}`} onClick={() => void session.toggleRecording()}>
            <Icon.Record size={14} /> {ui.recording ? 'Stop recording' : 'Record'}
          </button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className="sheet-body">
          <p className="hint" style={{ padding: '12px 18px 4px', margin: 0 }}>
            Press <b>Rec</b> (or Shift+R) and play. Everything you play on your keyboard is captured: notes, how hard you pressed, and the sustain pedal.
            You can record on its own or while a song plays. Recordings stay on this device.
          </p>
          {ui.takes.length === 0 ? <div className="empty">No recordings yet.</div> : (
            <div style={{ padding: '6px 10px' }}>
              {ui.takes.map((t) => {
                const playing = ui.playingTake === t.id;
                return (
                  <div key={t.id} className={`take-row ${playing ? 'playing' : ''}`}>
                    <button className={`play-mini ${playing ? 'on' : ''}`} aria-label={playing ? 'Stop' : 'Play recording'} onClick={() => (playing ? session.stopTake() : void session.playTake(t.id))}>
                      {playing ? <Icon.Stop size={14} /> : <Icon.Play size={14} />}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      {editing === t.id ? (
                        <input
                          type="text" defaultValue={t.name} autoFocus aria-label="Recording name"
                          style={{ width: '100%', height: 28, background: 'var(--bg-1)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 8px' }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { void session.renameTake(t.id, (e.target as HTMLInputElement).value); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                          onBlur={(e) => { void session.renameTake(t.id, e.target.value); setEditing(null); }}
                        />
                      ) : <div className="name" title={t.name}>{t.name}</div>}
                      <div className="sub">{fmtTime(t.duration)} · {t.noteCount} notes{t.songName ? ` · while practising ${t.songName}` : ''}</div>
                    </div>
                    <div className="take-acts">
                      <button className="btn sm" title="Show it as falling notes and practise it" onClick={() => { void session.openTakeAsSong(t.id); onClose(); }}>Open as song</button>
                      <button className="btn sm ghost" onClick={() => exportMidi(t.id, t.name)}><Icon.Download size={13} /> MIDI</button>
                      <button className="btn sm ghost" onClick={() => void exportWav(t.id, t.name)} disabled={busy === t.id}><Icon.Download size={13} /> {busy === t.id ? 'Rendering…' : 'WAV'}</button>
                      <button className="icon-btn" aria-label="Rename" onClick={() => setEditing(t.id)}><Icon.Edit size={15} /></button>
                      {confirmDelete === t.id
                        ? <button className="btn sm danger" onClick={() => { void session.deleteTake(t.id); setConfirmDelete(null); }}>Delete?</button>
                        : <button className="icon-btn" aria-label="Delete" onClick={() => setConfirmDelete(t.id)}><Icon.Trash size={15} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
