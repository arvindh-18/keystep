// MIDI device access across platforms:
//  - Web MIDI (desktop Chrome/Edge, Electron, Android Chrome)
//  - Native Android plugin (Capacitor app: android.media.midi via window.Capacitor)
// Exposes one normalized message stream and device list, with auto-reconnect.

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  kind: 'input' | 'output';
  connected: boolean;
}

export type MidiMessage =
  | { type: 'noteon'; note: number; velocity: number; channel: number; time: number; source: string }
  | { type: 'noteoff'; note: number; velocity: number; channel: number; time: number; source: string }
  | { type: 'cc'; controller: number; value: number; channel: number; time: number; source: string };

export type MidiBackend = 'webmidi' | 'android' | 'none';
export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'denied' | 'ready';

interface NativePlugin {
  listDevices(): Promise<{ devices: { id: string; name: string; manufacturer: string; inputs: number; outputs: number }[] }>;
  openInput(o: { id: string }): Promise<void>;
  closeInput(o: { id: string }): Promise<void>;
  openOutput(o: { id: string }): Promise<void>;
  closeOutput(): Promise<void>;
  send(o: { data: number[] }): Promise<void>;
  addListener(event: string, cb: (data: any) => void): Promise<{ remove: () => void }> | { remove: () => void };
}

let nativeCache: NativePlugin | null | undefined;
function nativePlugin(): NativePlugin | null {
  if (nativeCache !== undefined) return nativeCache;
  nativeCache = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' ? registerPlugin<NativePlugin>('KeystepMidi') : null;
  return nativeCache;
}

/** Parse raw MIDI bytes (possibly several messages, running status) into messages. */
export function parseMidiBytes(bytes: ArrayLike<number>, time: number, source: string, state = { running: 0 }): MidiMessage[] {
  const out: MidiMessage[] = [];
  let i = 0;
  while (i < bytes.length) {
    let status = bytes[i];
    if (status >= 0xf8) { i++; continue; } // real-time (clock, active sensing)
    if (status === 0xf0) { while (i < bytes.length && bytes[i] !== 0xf7) i++; i++; continue; }
    if (status < 0x80) { status = state.running; if (!status) { i++; continue; } } else { i++; if (status < 0xf0) state.running = status; else { continue; } }
    const type = status & 0xf0, channel = status & 0x0f;
    const need = type === 0xc0 || type === 0xd0 ? 1 : 2;
    const d1 = bytes[i] ?? 0, d2 = need === 2 ? bytes[i + 1] ?? 0 : 0;
    i += need;
    if (type === 0x90 && d2 > 0) out.push({ type: 'noteon', note: d1, velocity: d2, channel, time, source });
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) out.push({ type: 'noteoff', note: d1, velocity: d2, channel, time, source });
    else if (type === 0xb0) out.push({ type: 'cc', controller: d1, value: d2, channel, time, source });
  }
  return out;
}

export class MidiIO {
  backend: MidiBackend = 'none';
  status: MidiStatus = 'idle';
  devices: MidiDevice[] = [];
  /** Selected input ids; 'all' listens to every connected input. */
  selectedInputs: 'all' | string[] = 'all';
  selectedOutput: string | null = null;
  private remembered = { inputs: [] as string[], output: null as string | null }; // by name, for reconnect
  private access: MIDIAccess | null = null;
  private native: NativePlugin | null = null;
  private nativeOpen = new Set<string>();
  private listeners = new Set<(m: MidiMessage) => void>();
  private changeListeners = new Set<() => void>();
  lastActivity = 0;
  error = '';

  get supported(): boolean {
    return !!nativePlugin() || typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  onMessage(fn: (m: MidiMessage) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onChange(fn: () => void) { this.changeListeners.add(fn); return () => { this.changeListeners.delete(fn); }; }
  private changed() { for (const f of this.changeListeners) f(); }
  private dispatch(msgs: MidiMessage[]) {
    if (!msgs.length) return;
    this.lastActivity = performance.now();
    for (const m of msgs) for (const l of this.listeners) l(m);
  }

  restore(pref: { inputs?: string[]; output?: string | null }) {
    this.remembered = { inputs: pref.inputs ?? [], output: pref.output ?? null };
  }
  rememberedPrefs() {
    const names = (ids: string[]) => ids.map((id) => this.devices.find((d) => d.id === id)?.name).filter(Boolean) as string[];
    return {
      inputs: this.selectedInputs === 'all' ? [] : names(this.selectedInputs),
      output: this.selectedOutput ? this.devices.find((d) => d.id === this.selectedOutput)?.name ?? null : null,
    };
  }

  async start(): Promise<void> {
    if (this.status === 'ready' || this.status === 'requesting') return;
    this.native = nativePlugin();
    if (this.native) return this.startNative();
    if (!('requestMIDIAccess' in navigator)) { this.status = 'unsupported'; this.changed(); return; }
    this.status = 'requesting'; this.changed();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.backend = 'webmidi';
      this.status = 'ready';
      this.access.onstatechange = () => this.refreshWeb();
      this.refreshWeb();
    } catch (err) {
      this.status = 'denied';
      this.error = err instanceof Error ? err.message : String(err);
      this.changed();
    }
  }

  private refreshWeb() {
    if (!this.access) return;
    const list: MidiDevice[] = [];
    this.access.inputs.forEach((p) => list.push({ id: p.id, name: p.name || 'MIDI input', manufacturer: p.manufacturer || '', kind: 'input', connected: p.state === 'connected' }));
    this.access.outputs.forEach((p) => list.push({ id: p.id, name: p.name || 'MIDI output', manufacturer: p.manufacturer || '', kind: 'output', connected: p.state === 'connected' }));
    this.devices = list;
    this.applyRemembered();
    this.access.inputs.forEach((p) => {
      const state = { running: 0 };
      p.onmidimessage = (e: MIDIMessageEvent) => {
        if (!this.inputEnabled(p.id) || !e.data) return;
        this.dispatch(parseMidiBytes(e.data, e.timeStamp || performance.now(), p.id, state));
      };
    });
    this.changed();
  }

  private applyRemembered() {
    // Reconnect devices by name after unplug/replug or app restart.
    if (this.remembered.inputs.length && this.selectedInputs !== 'all') {
      const ids = this.devices.filter((d) => d.kind === 'input' && this.remembered.inputs.includes(d.name)).map((d) => d.id);
      this.selectedInputs = [...new Set([...(this.selectedInputs as string[]), ...ids])];
    } else if (this.remembered.inputs.length && this.selectedInputs === 'all') {
      const ids = this.devices.filter((d) => d.kind === 'input' && this.remembered.inputs.includes(d.name)).map((d) => d.id);
      if (ids.length) this.selectedInputs = ids;
    }
    if (this.remembered.output && !this.selectedOutput) {
      const d = this.devices.find((x) => x.kind === 'output' && x.name === this.remembered.output && x.connected);
      if (d) this.selectedOutput = d.id;
    }
  }

  inputEnabled(id: string) {
    return this.selectedInputs === 'all' || this.selectedInputs.includes(id);
  }

  setInputs(sel: 'all' | string[]) {
    this.selectedInputs = sel;
    this.remembered.inputs = sel === 'all' ? [] : sel.map((id) => this.devices.find((d) => d.id === id)?.name ?? '').filter(Boolean);
    if (this.native) void this.syncNativeInputs();
    this.changed();
  }

  async setOutput(id: string | null) {
    this.selectedOutput = id;
    this.remembered.output = id ? this.devices.find((d) => d.id === id)?.name ?? null : null;
    if (this.native) {
      try { if (id) await this.native.openOutput({ id: id.replace(/^out:/, '') }); else await this.native.closeOutput(); } catch (e) { this.error = String(e); }
    }
    this.changed();
  }

  get connectedInputs() { return this.devices.filter((d) => d.kind === 'input' && d.connected); }
  get activeInputs() { return this.connectedInputs.filter((d) => this.inputEnabled(d.id)); }

  send(bytes: number[], timestampMs?: number) {
    if (!this.selectedOutput) return;
    if (this.access) {
      const out = this.access.outputs.get(this.selectedOutput);
      if (out && out.state === 'connected') { try { out.send(bytes, timestampMs); } catch { /* device gone */ } }
    } else if (this.native) {
      void this.native.send({ data: bytes }).catch(() => undefined);
    }
  }

  allNotesOff() {
    for (let ch = 0; ch < 16; ch++) { this.send([0xb0 | ch, 123, 0]); this.send([0xb0 | ch, 64, 0]); }
  }

  // ---- Android native ----
  private async startNative() {
    const n = this.native!;
    this.backend = 'android';
    this.status = 'requesting'; this.changed();
    try {
      await n.addListener('midiMessage', (ev: { id: string; data: number[]; timestamp?: number }) => {
        // The plugin timestamps with System.nanoTime(); convert by arrival time instead (WebView clock differs).
        this.dispatch(parseMidiBytes(ev.data, performance.now(), 'in:' + ev.id));
      });
      await n.addListener('devicesChanged', () => void this.refreshNative());
      this.status = 'ready';
      await this.refreshNative();
    } catch (e) {
      this.status = 'denied';
      this.error = String(e);
      this.changed();
    }
  }

  private async refreshNative() {
    const n = this.native!;
    const { devices } = await n.listDevices();
    const list: MidiDevice[] = [];
    for (const d of devices) {
      if (d.outputs > 0) list.push({ id: 'in:' + d.id, name: d.name, manufacturer: d.manufacturer, kind: 'input', connected: true });
      if (d.inputs > 0) list.push({ id: 'out:' + d.id, name: d.name, manufacturer: d.manufacturer, kind: 'output', connected: true });
    }
    this.devices = list;
    this.applyRemembered();
    await this.syncNativeInputs();
    this.changed();
  }

  private async syncNativeInputs() {
    const n = this.native!;
    const want = new Set(this.devices.filter((d) => d.kind === 'input' && this.inputEnabled(d.id)).map((d) => d.id.slice(3)));
    for (const id of [...this.nativeOpen]) if (!want.has(id)) { await n.closeInput({ id }).catch(() => undefined); this.nativeOpen.delete(id); }
    for (const id of want) if (!this.nativeOpen.has(id)) {
      try { await n.openInput({ id }); this.nativeOpen.add(id); } catch (e) { this.error = String(e); }
    }
  }
}
