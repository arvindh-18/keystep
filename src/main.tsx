import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './ui/styles.css';
import { App } from './ui/App';
import { Session } from './engine/session';

const session = new Session();
(window as unknown as { keystep: Session }).keystep = session; // handy for debugging and tests

// Browsers only allow audio after a user gesture; unlock on the first one.
const unlock = () => { void session.ensureAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// Files opened with the app (Electron "Open with", Android share/view intents).
(window as unknown as { keystepOpenFile: (name: string, bytes: ArrayBuffer) => void }).keystepOpenFile = (name, bytes) => {
  void session.importBytes(bytes, name);
};

// Desktop app (Electron preload bridge)
const native = (window as unknown as { keystepNative?: { onOpenFile(cb: (name: string, bytes: ArrayBuffer) => void): void } }).keystepNative;
native?.onOpenFile((name, bytes) => void session.importBytes(bytes, name));

createRoot(document.getElementById('root')!).render(<App session={session} />);
void session.init();
