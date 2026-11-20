// Keystep desktop shell (Windows / macOS / Linux).
const { app, BrowserWindow, protocol, session, Menu, shell, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, '..', 'dist');
const MIDI_EXT = /\.(mid|midi|kar|rmi)$/i;

// app:// is a secure, standard origin: Web MIDI, IndexedDB and fetch all work.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
const pendingFiles = [];

function sendFile(file) {
  try {
    const bytes = fs.readFileSync(file);
    const payload = { name: path.basename(file), bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    if (win && !win.webContents.isLoading()) win.webContents.send('open-file', payload);
    else pendingFiles.push(payload);
  } catch (e) { console.error('open-file failed', e); }
}

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => MIDI_EXT.test(a) && fs.existsSync(a));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 720, minHeight: 460,
    backgroundColor: '#0B0C0E', title: 'Keystep', show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, // keep audio scheduling and MIDI timing steady
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => { while (pendingFiles.length) win.webContents.send('open-file', pendingFiles.shift()); });
  // External links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.loadURL('app://keystep/index.html');
  if (process.env.KEYSTEP_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      const r = await win.webContents.executeJavaScript("navigator.requestMIDIAccess().then(a => 'MIDI_OK inputs=' + a.inputs.size, e => 'MIDI_FAIL ' + e)");
      console.log(r);
      if (process.env.KEYSTEP_SELFTEST_URL) {
        const f = await win.webContents.executeJavaScript(`window.keystepNative.fetchBytes(${JSON.stringify(process.env.KEYSTEP_SELFTEST_URL)}).then(b => 'FETCH_OK bytes=' + b.byteLength + ' head=' + String.fromCharCode(...new Uint8Array(b).slice(0, 4)), e => 'FETCH_FAIL ' + e)`);
        console.log(f);
      }
      app.quit();
    });
  }
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    filesFromArgv(argv).forEach(sendFile);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  // macOS: files opened from Finder.
  app.on('open-file', (e, file) => { e.preventDefault(); sendFile(file); });

  // Online song search/downloads: done here so remote sites don't need CORS headers.
  const remote = async (url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links are allowed');
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Keystep/1.0 (MIDI piano practice)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 64 * 1024 * 1024) throw new Error('File too large');
    return r;
  };
  ipcMain.handle('fetch-bytes', async (_e, url) => new Uint8Array(await (await remote(url)).arrayBuffer()));
  ipcMain.handle('fetch-text', async (_e, url) => (await remote(url)).text());

  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    const allowed = new Set(['midi', 'midiSysex', 'fullscreen', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    const isMac = process.platform === 'darwin';
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));

    filesFromArgv(process.argv).forEach(sendFile);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
