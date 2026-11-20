// Local persistence (IndexedDB): song library, per-song preferences,
// practice session history and app settings. Everything stays on the device.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Take } from './recorder';

export interface StoredSong {
  id: string;
  name: string;
  fileName: string;
  bytes: ArrayBuffer;
  size: number;
  addedAt: number;
  lastPlayedAt: number;
  favorite: boolean;
  builtIn?: boolean;
  durationSec?: number;
  noteCount?: number;
}

export interface SongPrefs {
  songId: string;
  roles?: string[];
  trackVolumes?: number[];
  speed?: number;
  transpose?: number;
  loop?: { startMeasure: number; endMeasure: number; enabled: boolean };
  position?: number;
}

export interface SessionRecord {
  id?: number;
  songId: string;
  songName: string;
  date: number;
  mode: string;
  hands: string;
  speed: number;
  hits: number;
  wrong: number;
  missed: number;
  accuracy: number;
  activeSeconds: number;
  measureErrors: Record<number, number>;
  loop?: [number, number];
}

interface Schema extends DBSchema {
  songs: { key: string; value: StoredSong; indexes: { lastPlayedAt: number } };
  prefs: { key: string; value: SongPrefs };
  sessions: { key: number; value: SessionRecord; indexes: { songId: string } };
  kv: { key: string; value: unknown };
  recordings: { key: string; value: Take; indexes: { date: number } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('keystep', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const songs = d.createObjectStore('songs', { keyPath: 'id' });
          songs.createIndex('lastPlayedAt', 'lastPlayedAt');
          d.createObjectStore('prefs', { keyPath: 'songId' });
          const sessions = d.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          sessions.createIndex('songId', 'songId');
          d.createObjectStore('kv');
        }
        if (oldVersion < 2) {
          const rec = d.createObjectStore('recordings', { keyPath: 'id' });
          rec.createIndex('date', 'date');
        }
      },
    });
  }
  return dbp;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.warn('storage', e); return fallback; }
}

export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest)).slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle needs a secure context; fall back to FNV-1a.
    const u = new Uint8Array(bytes);
    let h = 0x811c9dc5;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + '-' + u.length.toString(16);
  }
}

export const storage = {
  listSongs: () => safe(async () => (await (await db()).getAll('songs')).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || b.addedAt - a.addedAt), [] as StoredSong[]),
  getSong: (id: string) => safe(async () => (await db()).get('songs', id), undefined),
  putSong: (s: StoredSong) => safe(async () => { await (await db()).put('songs', s); }, undefined),
  deleteSong: (id: string) => safe(async () => {
    const d = await db();
    await d.delete('songs', id);
    await d.delete('prefs', id);
  }, undefined),
  getPrefs: (id: string) => safe(async () => (await db()).get('prefs', id), undefined),
  putPrefs: (p: SongPrefs) => safe(async () => { await (await db()).put('prefs', p); }, undefined),
  addSession: (r: SessionRecord) => safe(async () => { await (await db()).add('sessions', r); }, undefined),
  sessionsFor: (songId: string) => safe(async () => (await (await db()).getAllFromIndex('sessions', 'songId', songId)).sort((a, b) => a.date - b.date), [] as SessionRecord[]),
  allSessions: () => safe(async () => (await (await db()).getAll('sessions')).sort((a, b) => b.date - a.date), [] as SessionRecord[]),
  listTakes: () => safe(async () => (await (await db()).getAll('recordings')).sort((a, b) => b.date - a.date), [] as Take[]),
  putTake: (t: Take) => safe(async () => { await (await db()).put('recordings', t); }, undefined),
  deleteTake: (id: string) => safe(async () => { await (await db()).delete('recordings', id); }, undefined),
  getKV: <T>(key: string) => safe(async () => (await (await db()).get('kv', key)) as T | undefined, undefined),
  setKV: (key: string, value: unknown) => safe(async () => { await (await db()).put('kv', value, key); }, undefined),
};
