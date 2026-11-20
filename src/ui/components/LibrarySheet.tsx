import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session, UiState } from '../../engine/session';
import { Icon } from '../icons';
import { fmtTime } from '../controls';
import { OnlinePanel } from './OnlinePanel';
import { filesFromDrop } from '../../engine/bulkImport';

type Filter = 'all' | 'favorites' | 'imported' | 'builtin';

export function LibrarySheet({ session, ui, onClose }: { session: Session; ui: UiState; onClose: () => void }) {
  const [tab, setTab] = useState<'mine' | 'online'>('mine');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const sort = ui.settings.librarySort;
  const songs = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const list = ui.library.filter((s) => {
      if (filter === 'favorites' && !s.favorite) return false;
      if (filter === 'imported' && s.builtIn) return false;
      if (filter === 'builtin' && !s.builtIn) return false;
      return !qq || s.name.toLowerCase().includes(qq) || s.fileName.toLowerCase().includes(qq);
    });
    const by = {
      name: (a: typeof list[number], b: typeof list[number]) => coll.compare(a.name, b.name),
      played: (a: typeof list[number], b: typeof list[number]) => (b.lastPlayedAt - a.lastPlayedAt) || coll.compare(a.name, b.name),
      added: (a: typeof list[number], b: typeof list[number]) => (b.addedAt - a.addedAt) || coll.compare(a.name, b.name),
      length: (a: typeof list[number], b: typeof list[number]) => ((a.durationSec ?? 0) - (b.durationSec ?? 0)) || coll.compare(a.name, b.name),
    }[sort];
    return [...list].sort(by);
  }, [ui.library, q, filter, sort]);

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(mid|midi|kar|rmi|zip)$/i.test(f.name));
    if (!list.length) { session.error = 'Choose .mid, .midi or .zip files.'; session.update({}); return; }
    if (list.length === 1 && !/\.zip$/i.test(list[0].name)) {
      if (await session.importFile(list[0])) onClose();
      return;
    }
    await session.importMany(list);
    setFilter('imported');
  };

  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Song library">
        <div className="sheet-head">
          <Icon.Library />
          <h2>Library</h2>
          <div className="spacer" />
          <button className="btn hide-xs" onClick={() => folderRef.current?.click()} title="Import every MIDI file in a folder">Import folder</button>
          <button className="btn primary" onClick={() => fileRef.current?.click()} title="MIDI files or .zip bundles"><Icon.Upload size={15} /> Import</button>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button>
          <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { const input = e.target; if (input.files) void importFiles(input.files).finally(() => { input.value = ''; }); }} />
          <input ref={fileRef} type="file" accept=".mid,.midi,.kar,.rmi,.zip,audio/midi,audio/x-midi,application/zip" multiple hidden onChange={(e) => { const input = e.target; if (input.files) void importFiles(input.files).finally(() => { input.value = ''; }); }} />
        </div>
        <div className="sheet-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My songs</button>
          <button role="tab" aria-selected={tab === 'online'} className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}>Find online</button>
        </div>
        {tab === 'online' ? <div className="sheet-body"><OnlinePanel session={session} onOpened={onClose} /></div> : (
        <div className="sheet-body">
          <div className="lib-tools">
            <label className="search"><Icon.Search size={15} /><input type="search" placeholder="Search songs" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <select aria-label="Sort songs" value={sort} onChange={(e) => session.update({ librarySort: e.target.value as typeof sort })} style={{ height: 34 }}>
              <option value="name">Sort: A–Z</option>
              <option value="played">Sort: Recently played</option>
              <option value="added">Sort: Recently added</option>
              <option value="length">Sort: Shortest first</option>
            </select>
            <div className="seg" style={{ width: 300 }}>
              {(['all', 'favorites', 'imported', 'builtin'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ all: 'All', favorites: 'Favourites', imported: 'Imported', builtin: 'Built-in' }[f]}</button>
              ))}
            </div>
          </div>
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); void filesFromDrop(e.dataTransfer).then(importFiles); }}
          >
            Drop MIDI files, <b>.zip bundles</b> or whole folders here. Files stay on this device.
          </div>
          {ui.importProgress && (
            <div style={{ margin: '0 18px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="meter"><i style={{ width: `${ui.importProgress.total ? (ui.importProgress.done / ui.importProgress.total) * 100 : 5}%`, background: 'var(--accent)' }} /></div>
              <span className="mono" style={{ fontSize: 12 }}>{ui.importProgress.total ? `${ui.importProgress.done}/${ui.importProgress.total}` : 'Reading…'}</span>
            </div>
          )}
          {ui.notice && <div className="notice" style={{ borderColor: '#3b3566', background: 'var(--accent-soft)', color: 'var(--text-1)', marginTop: 0 }}>{ui.notice}</div>}
          <p className="hint" style={{ padding: '0 18px', margin: '0 0 4px' }}>{songs.length} song{songs.length === 1 ? '' : 's'}</p>
          {songs.length === 0 ? <div className="empty">No songs match.</div> : (
            <ul className="song-list">
              {songs.map((s) => (
                <li key={s.id} className={`song-row ${s.id === ui.songId ? 'current' : ''}`} onClick={() => { if (editing !== s.id) { void session.openStored(s.id); onClose(); } }}>
                  <button className={`icon-btn fav ${s.favorite ? 'on' : ''}`} aria-label={s.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => { e.stopPropagation(); void session.toggleFavorite(s.id); }}>
                    <Icon.Star size={16} filled={s.favorite} />
                  </button>
                  <div style={{ minWidth: 0 }}>
                    {editing === s.id ? (
                      <input
                        type="text" defaultValue={s.name} autoFocus aria-label="Song name"
                        style={{ width: '100%', height: 28, background: 'var(--bg-1)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 8px' }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Enter') { void session.renameSong(s.id, (e.target as HTMLInputElement).value); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                        onBlur={(e) => { void session.renameSong(s.id, e.target.value); setEditing(null); }}
                      />
                    ) : <div className="name">{s.name}</div>}
                    <div className="sub">
                      {s.builtIn ? 'Built-in' : s.fileName}
                      {s.durationSec ? ` · ${fmtTime(s.durationSec)}` : ''}
                      {s.noteCount ? ` · ${s.noteCount} notes` : ''}
                      {s.lastPlayedAt ? ` · played ${relTime(s.lastPlayedAt)}` : ''}
                      {ui.previewing === s.id && <PreviewTime session={session} />}
                    </div>
                  </div>
                  {s.builtIn ? <span className="badge">Demo</span> : <span />}
                  <div className="acts" onClick={(e) => e.stopPropagation()} style={ui.previewing === s.id ? { opacity: 1 } : undefined}>
                    <button className={`play-mini ${ui.previewing === s.id ? 'on' : ''}`} style={{ width: 30, height: 30 }} title={ui.previewing === s.id ? 'Stop' : 'Listen to this song'} aria-label={ui.previewing === s.id ? 'Stop preview' : `Listen to ${s.name}`} onClick={() => void session.previewSong(s.id)}>
                      {ui.previewing === s.id ? <Icon.Stop size={12} /> : <Icon.Play size={12} />}
                    </button>
                    <button className="icon-btn" aria-label="Rename" onClick={() => setEditing(s.id)}><Icon.Edit size={15} /></button>
                    {confirmDelete === s.id ? (
                      <button className="btn sm danger" onClick={() => { void session.deleteSong(s.id); setConfirmDelete(null); }}>Delete?</button>
                    ) : (
                      <button className="icon-btn" aria-label="Delete" onClick={() => setConfirmDelete(s.id)}><Icon.Trash size={15} /></button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function PreviewTime({ session }: { session: Session }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 250); return () => clearInterval(t); }, []);
  return <span style={{ color: 'var(--accent)' }}> · playing {fmtTime(session.previewElapsed)} / {fmtTime(session.previewDuration)}</span>;
}

function relTime(ts: number) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}
