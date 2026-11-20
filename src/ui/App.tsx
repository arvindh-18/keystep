import { useEffect, useState } from 'react';
import type { Session } from '../engine/session';
import { useSession, fmtTime } from './controls';
import { Icon } from './icons';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { TransportBar } from './components/TransportBar';
import { PracticeDrawer } from './components/PracticeDrawer';
import { LibrarySheet } from './components/LibrarySheet';
import { DevicesSheet } from './components/DevicesSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { StatsSheet } from './components/StatsSheet';
import { RecordingsSheet } from './components/RecordingsSheet';
import { useHotkeys } from './hotkeys';
import { filesFromDrop } from '../engine/bulkImport';

type Sheet = null | 'library' | 'devices' | 'settings' | 'stats' | 'recordings';
const MODE_LABEL = { wait: 'Wait', playalong: 'Play-along', listen: 'Listen', free: 'Free' } as const;

export function App({ session }: { session: Session }) {
  const ui = useSession(session);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [wide, setWide] = useState(() => window.innerWidth >= 1100);
  const [drawer, setDrawer] = useState(() => window.innerWidth >= 1100);
  const [dragOver, setDragOver] = useState(false);
  const [midiBlink, setMidiBlink] = useState(false);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth >= 1100;
      setWide((prev) => { if (prev !== w) setDrawer(w); return w; });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Blink the MIDI dot on activity.
  useEffect(() => session.midi.onMessage(() => { setMidiBlink(true); setTimeout(() => setMidiBlink(false), 120); }), [session]);

  // Whole-window drag and drop of MIDI files.
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => { if (isFiles(e)) { depth++; setDragOver(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragOver(false); };
    const over = (e: DragEvent) => { if (isFiles(e)) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = (await filesFromDrop(e.dataTransfer!)).filter((f) => /\.(mid|midi|kar|rmi|zip)$/i.test(f.name));
      if (!files.length) { session.error = 'Only .mid, .midi and .zip files (or folders of them) can be opened.'; session.update({}); return; }
      if (files.length === 1 && !/\.zip$/i.test(files[0].name)) await session.importFile(files[0]);
      else await session.importMany(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [session]);

  useHotkeys(session, sheet !== null, () => setSheet('library'));

  const inputs = ui.midiDevices.filter((d) => d.kind === 'input' && d.connected);
  const midiLabel = ui.midiStatus === 'ready' ? (inputs.length ? (inputs.length === 1 ? inputs[0].name : `${inputs.length} inputs`) : 'No keyboard') : ui.midiStatus === 'unsupported' ? 'No MIDI' : ui.midiStatus === 'denied' ? 'MIDI blocked' : 'MIDI…';
  const midiDot = ui.midiStatus === 'ready' ? (inputs.length ? 'ok' : 'warn') : ui.midiStatus === 'denied' || ui.midiStatus === 'unsupported' ? 'bad' : '';
  const song = ui.song;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" aria-label="Keystep"><span className="brand-mark"><i /><i /><i /></span><span>KEYSTEP</span></div>
        <button className="song-btn" onClick={() => setSheet('library')} title="Open library (Ctrl+O)">
          <Icon.Library size={16} />
          <span className="song-title">{song ? ui.title : 'Open a song'}</span>
          {song && <span className="song-meta mono">{fmtTime(song.duration)} · {song.measures.length} bars · {song.tracks.length} trk</span>}
        </button>
        <div className="spacer" />
        <button className="pill" onClick={() => setSheet('devices')} title="MIDI devices">
          <span className={`dot ${midiDot} ${midiBlink ? 'active' : ''}`} />
          <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{midiLabel}</span>
        </button>
        <button className="pill hide-xs" onClick={() => setDrawer(true)} title="Practice mode">
          {MODE_LABEL[ui.settings.mode]} · {ui.settings.hands === 'both' ? 'Both hands' : ui.settings.hands === 'right' ? 'Right hand' : 'Left hand'}
        </button>
        <button className={`icon-btn ${ui.recording ? 'on' : ''}`} aria-label="Recordings" title="Recordings" onClick={() => setSheet('recordings')}><Icon.Takes /></button>
        <button className="icon-btn" aria-label="Statistics" title="Statistics" onClick={() => setSheet('stats')}><Icon.Chart /></button>
        <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setSheet('settings')}><Icon.Settings /></button>
        <button className="icon-btn hide-xs" aria-label="Full screen" title="Full screen" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}><Icon.Fullscreen /></button>
        <button className={`icon-btn ${drawer ? 'on' : ''}`} aria-label="Practice panel" title="Practice panel" aria-pressed={drawer} onClick={() => setDrawer((d) => !d)}><Icon.Sliders /></button>
      </header>

      <div className="body">
        <main className="workspace">
          <Stage session={session} ui={ui} onOpenLibrary={() => setSheet('library')} />
          <Timeline session={session} ui={ui} />
          {drawer && !wide && <PracticeDrawer session={session} ui={ui} overlay onClose={() => setDrawer(false)} />}
        </main>
        {drawer && wide && <PracticeDrawer session={session} ui={ui} overlay={false} onClose={() => setDrawer(false)} />}
      </div>

      <TransportBar session={session} ui={ui} onStats={() => setSheet('stats')} />

      {sheet === 'library' && <LibrarySheet session={session} ui={ui} onClose={() => setSheet(null)} />}
      {sheet === 'devices' && <DevicesSheet session={session} ui={ui} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet session={session} ui={ui} onClose={() => setSheet(null)} />}
      {sheet === 'stats' && <StatsSheet session={session} ui={ui} onClose={() => setSheet(null)} />}
      {sheet === 'recordings' && <RecordingsSheet session={session} ui={ui} onClose={() => setSheet(null)} />}

      {ui.lastTake && !sheet && !ui.recording && (
        <div className="toast info" role="status">
          <span>Recording saved — {fmtTime(ui.lastTake.duration)}, {ui.lastTake.noteCount} notes.</span>
          <button className="btn sm" onClick={() => (ui.playingTake ? session.stopTake() : void session.playTake(ui.lastTake!.id))}>{ui.playingTake === ui.lastTake.id ? 'Stop' : 'Play'}</button>
          <button className="btn sm" onClick={() => setSheet('recordings')}>All recordings</button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissLastTake()}><Icon.Close size={15} /></button>
        </div>
      )}

      {ui.finished && ui.settings.mode !== 'listen' && ui.stats.hits + ui.stats.wrong + ui.stats.missed > 0 && !sheet && (
        <div className="toast info" role="status">
          <span>Finished — {Math.round(ui.stats.accuracy * 100)}% accuracy at {Math.round(ui.settings.speed * 100)}% speed.</span>
          <button className="btn sm" onClick={() => setSheet('stats')}>Details</button>
          <button className="btn sm primary" onClick={() => session.restart()}>Again</button>
        </div>
      )}
      {ui.importProgress && sheet !== 'library' && (
        <div className="toast info" role="status"><span>Importing songs… {ui.importProgress.total ? `${ui.importProgress.done}/${ui.importProgress.total}` : ''}</span></div>
      )}
      {ui.notice && sheet !== 'library' && !ui.importProgress && (
        <div className="toast info" role="status">
          <span>{ui.notice}</span>
          <button className="btn sm" onClick={() => { session.dismissNotice(); setSheet('library'); }}>Open library</button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => session.dismissNotice()}><Icon.Close size={15} /></button>
        </div>
      )}
      {ui.error && (
        <div className="toast" role="alert">
          <span>{ui.error}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => { session.error = null; session.update({}); }}><Icon.Close size={15} /></button>
        </div>
      )}
      {dragOver && <div className="drop-overlay"><div>Drop MIDI files, zip bundles or folders</div></div>}
    </div>
  );
}
