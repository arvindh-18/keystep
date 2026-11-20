import { useRef, useState } from 'react';
import type { Session } from '../../engine/session';
import { searchOnline, type OnlineResult } from '../../engine/online';
import { Icon } from '../icons';

const SUGGESTIONS = ['Fur Elise', 'Moonlight Sonata', 'Canon in D', 'River Flows in You', 'Interstellar', 'Let It Be', 'Imagine', 'Bohemian Rhapsody', 'Perfect', 'Clocks'];

export function OnlinePanel({ session, onOpened }: { session: Session; onOpened: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<OnlineResult[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const searched = useRef('');

  const run = async (query: string, p = 0) => {
    if (!query.trim()) return;
    setLoading(true);
    setErr(null);
    searched.current = query;
    try {
      const r = await searchOnline(query, p);
      setResults(p === 0 ? r.results : (prev) => [...prev, ...r.results]);
      setPage(p);
      setPages(r.pages);
      setTotal(r.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (p === 0) setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const open = async (r: OnlineResult) => {
    setOpening(r.id);
    const ok = await session.importFromUrl(r.downloadUrl, r.name);
    setOpening(null);
    if (ok) onOpened();
  };

  const openLink = async () => {
    if (!link.trim()) return;
    setOpening('link');
    const ok = await session.importFromUrl(link);
    setOpening(null);
    if (ok) { setLink(''); onOpened(); }
  };

  return (
    <div>
      <form className="lib-tools" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
        <label className="search"><Icon.Search size={15} /><input type="search" placeholder="Search songs online, e.g. Für Elise, Interstellar…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
        <button className="btn primary" type="submit" disabled={loading || !q.trim()}>{loading && page === 0 ? 'Searching…' : 'Search'}</button>
      </form>

      {!searched.current && (
        <div style={{ padding: '0 18px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map((s) => <button key={s} className="btn sm ghost" onClick={() => { setQ(s); void run(s); }}>{s}</button>)}
        </div>
      )}

      {err && <div className="notice" style={{ marginTop: 0 }}>{err}</div>}

      {searched.current && !loading && !err && results.length === 0 && <div className="empty">No songs found for “{searched.current}”. Try fewer words or another spelling.</div>}

      {results.length > 0 && (
        <>
          <p className="hint" style={{ padding: '0 18px', margin: '0 0 4px' }}>{total} results from BitMidi · tap a song to download and open it</p>
          <ul className="song-list">
            {results.map((r) => (
              <li key={r.id} className="song-row" style={{ gridTemplateColumns: '28px minmax(0,1fr) auto' }} onClick={() => void open(r)}>
                <span style={{ color: 'var(--text-3)', display: 'grid', placeItems: 'center' }}><Icon.Library size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="name">{r.name}</div>
                  <div className="sub">{r.plays.toLocaleString()} plays · {r.source}</div>
                </div>
                <button className="btn sm" disabled={opening !== null} onClick={(e) => { e.stopPropagation(); void open(r); }}>
                  {opening === r.id ? 'Downloading…' : <><Icon.Download size={13} /> Open</>}
                </button>
              </li>
            ))}
          </ul>
          {page + 1 < pages && (
            <div style={{ padding: '8px 18px' }}><button className="btn sm block" disabled={loading} onClick={() => void run(searched.current, page + 1)}>{loading ? 'Loading…' : 'More results'}</button></div>
          )}
        </>
      )}

      <div className="section" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 'none', marginTop: 8 }}>
        <h3>Import from a link</h3>
        <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void openLink(); }}>
          <label className="search" style={{ minWidth: 0 }}><input type="url" placeholder="https://…/song.mid" value={link} onChange={(e) => setLink(e.target.value)} aria-label="MIDI file link" /></label>
          <button className="btn" type="submit" disabled={!link.trim() || opening !== null}>{opening === 'link' ? 'Downloading…' : 'Open'}</button>
        </form>
        <p className="hint">Paste a direct link to a .mid file from any website. Downloaded songs are saved in your library, so they work offline afterwards.</p>
      </div>
    </div>
  );
}
