// Collects MIDI files from many sources at once: loose files, .zip archives
// (including zips inside zips) and dropped folders.

import { unzip } from 'fflate';

export interface MidiEntry { name: string; bytes: ArrayBuffer }

const MIDI_RE = /\.(mid|midi|kar|rmi)$/i;
const ZIP_RE = /\.zip$/i;
const MAX_ENTRIES = 5000;

export const isMidiName = (n: string) => MIDI_RE.test(n);
export const isZipName = (n: string) => ZIP_RE.test(n);

function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, {
      // Only inflate MIDI files and nested zips; skip everything else (and macOS metadata).
      filter: (f) => !f.name.includes('__MACOSX/') && !baseName(f.name).startsWith('._') && (MIDI_RE.test(f.name) || ZIP_RE.test(f.name)) && f.originalSize < 20 * 1024 * 1024,
    }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

async function fromZip(data: Uint8Array, out: MidiEntry[], depth: number) {
  const files = await unzipAsync(data);
  for (const [path, bytes] of Object.entries(files)) {
    if (out.length >= MAX_ENTRIES) return;
    if (MIDI_RE.test(path)) out.push({ name: baseName(path), bytes: bytes.slice().buffer as ArrayBuffer });
    else if (ZIP_RE.test(path) && depth < 2) await fromZip(bytes, out, depth + 1);
  }
}

/** Expand a list of files (MIDI and/or zip) into MIDI entries. Other files are ignored. */
export async function collectMidi(files: File[]): Promise<{ entries: MidiEntry[]; ignored: number; unreadable: number }> {
  const entries: MidiEntry[] = [];
  let ignored = 0;
  for (const f of files) {
    if (entries.length >= MAX_ENTRIES) break;
    if (MIDI_RE.test(f.name)) {
      // One unreadable file must not stop the rest of the import.
      try { entries.push({ name: f.name, bytes: await f.arrayBuffer() }); } catch { ignored++; }
    } else if (ZIP_RE.test(f.name)) {
      try { await fromZip(new Uint8Array(await f.arrayBuffer()), entries, 0); } catch { ignored++; }
    } else ignored++;
  }
  return { entries, ignored, unreadable: ignored };
}

/** Read every file inside dropped folders (DataTransfer items). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean) as FileSystemEntry[];
  if (!entries.length || !entries.some((e) => e.isDirectory)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (out.length >= MAX_ENTRIES) return;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      if (MIDI_RE.test(file.name) || ZIP_RE.test(file.name)) out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in batches until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
