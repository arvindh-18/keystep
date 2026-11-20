// Online song search (BitMidi public API) and downloading MIDI files by URL.
// Desktop: requests go through the Electron main process (no CORS limits).
// Android: Capacitor's native HTTP handles fetch. Browser: plain fetch.

export interface OnlineResult {
  id: string;
  name: string;
  downloadUrl: string;
  pageUrl: string;
  plays: number;
  source: string;
}

export interface OnlineSearch { results: OnlineResult[]; total: number; pages: number; page: number }

const BITMIDI = 'https://bitmidi.com';
const MAX_BYTES = 60 * 1024 * 1024;

interface NativeBridge { fetchBytes?: (url: string) => Promise<ArrayBuffer>; fetchText?: (url: string) => Promise<string> }
const native = (): NativeBridge | undefined => (window as unknown as { keystepNative?: NativeBridge }).keystepNative;

async function getText(url: string): Promise<string> {
  const n = native();
  if (n?.fetchText) return n.fetchText(url);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Use a link that starts with https://');
  const n = native();
  let buf: ArrayBuffer;
  if (n?.fetchBytes) buf = await n.fetchBytes(url);
  else {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`The server answered ${r.status}`);
    buf = await r.arrayBuffer();
  }
  if (buf.byteLength > MAX_BYTES) throw new Error('File is larger than 60 MB');
  const u = new Uint8Array(buf);
  let isMidi = false;
  for (let i = 0; i + 4 <= Math.min(u.length, 1024); i++) if (u[i] === 0x4d && u[i + 1] === 0x54 && u[i + 2] === 0x68 && u[i + 3] === 0x64) { isMidi = true; break; }
  const isZip = u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04;
  if (!isMidi && !isZip) throw new Error('That link is not a MIDI or zip file. Use a direct link to a .mid or .zip file.');
  return buf;
}

export async function searchOnline(query: string, page = 0, pageSize = 25): Promise<OnlineSearch> {
  const q = query.trim();
  if (!q) return { results: [], total: 0, pages: 0, page: 0 };
  const url = `${BITMIDI}/api/midi/search?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`;
  let data: { result?: { results?: Array<{ id: number; name: string; url: string; downloadUrl: string; plays?: number }>; total?: number; pageTotal?: number } };
  try {
    data = JSON.parse(await getText(url));
  } catch (e) {
    throw new Error(navigator.onLine === false ? 'You are offline. Connect to the internet to search for songs.' : `Search failed (${e instanceof Error ? e.message : e}).`);
  }
  const res = data.result?.results ?? [];
  return {
    results: res.map((r) => ({
      id: `bitmidi-${r.id}`,
      name: r.name.replace(/\.(mid|midi|kar)$/i, '').replace(/[_]+/g, ' ').trim(),
      downloadUrl: BITMIDI + r.downloadUrl,
      pageUrl: BITMIDI + r.url,
      plays: r.plays ?? 0,
      source: 'BitMidi',
    })),
    total: data.result?.total ?? res.length,
    pages: data.result?.pageTotal ?? 1,
    page,
  };
}

/** A readable file name from a URL, for links pasted by the user. */
export function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'Song.mid');
    return /\.(mid|midi|kar)$/i.test(last) ? last : `${last}.mid`;
  } catch { return 'Song.mid'; }
}
