const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen } = require('electron');
const detect = require('./detect');
const path = require('path');
const fs = require('fs');

// Window settings that outlive the page: transparency, always-on-top, size and position.
let prefs = { transparent: false, onTop: false, bounds: null, skipVersion: '' };
let win = null;

function prefsFile() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function loadPrefs() {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    if (p && typeof p === 'object') {
      prefs.transparent = p.transparent === true;
      prefs.onTop = p.onTop === true;
      prefs.skipVersion = typeof p.skipVersion === 'string' ? p.skipVersion : '';
      const b = p.bounds;
      if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) prefs.bounds = b;
    }
  } catch (e) { /* first run: keep defaults */ }
}

function savePrefs() {
  try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) { /* ignore */ }
}

function createWindow() {
  const b = prefs.bounds || { width: 560, height: 900 };
  const opts = {
    width: b.width,
    height: b.height,
    minWidth: 320,
    minHeight: 260,
    title: 'BO1 Drop Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) { opts.x = b.x; opts.y = b.y; }
  if (prefs.transparent) {
    // A see-through window has to be created that way, so toggling recreates the window.
    opts.transparent = true;
    opts.frame = false;
    opts.hasShadow = false;
    opts.backgroundColor = '#00000000';
  } else {
    opts.backgroundColor = '#141414';
  }
  const w = new BrowserWindow(opts);
  win = w;
  w.loadFile(path.join(__dirname, 'index.html'));
  if (prefs.onTop) w.setAlwaysOnTop(true, 'screen-saver');
  w.on('close', () => {
    if (!w.isDestroyed() && !w.isMinimized()) {
      prefs.bounds = w.getBounds();
      savePrefs();
    }
  });
  w.on('closed', () => { if (win === w) win = null; });
}

ipcMain.handle('get-prefs', () => ({ transparent: prefs.transparent, onTop: prefs.onTop }));

ipcMain.on('set-always-on-top', (_event, flag) => {
  prefs.onTop = flag === true;
  savePrefs();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(prefs.onTop, 'screen-saver');
});

ipcMain.on('set-transparent', (_event, flag) => {
  const on = flag === true;
  if (on === prefs.transparent) return;
  const old = win;
  if (old && !old.isDestroyed()) prefs.bounds = old.getBounds();
  prefs.transparent = on;
  savePrefs();
  createWindow();
  if (old && !old.isDestroyed()) old.destroy();
});

ipcMain.on('win-minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.on('win-close', () => { if (win && !win.isDestroyed()) win.close(); });

// Global hotkeys for stepping the round up or down, even when another window has focus.
ipcMain.handle('set-hotkeys', (_event, cfg) => {
  globalShortcut.unregisterAll();
  const result = { up: 'none', down: 'none' };
  [['up', 1], ['down', -1]].forEach(([key, step]) => {
    const accel = cfg && typeof cfg[key] === 'string' ? cfg[key].slice(0, 40) : '';
    if (!accel) return;
    try {
      const ok = globalShortcut.register(accel, () => {
        if (win && !win.isDestroyed()) win.webContents.send('round-step', step);
      });
      result[key] = ok ? 'ok' : 'busy';
    } catch (e) {
      result[key] = 'invalid';
    }
  });
  return result;
});

// Round detection: look at a corner of the screen once a second and read the round counter.
// Only screen pixels are read. Nothing touches the game itself.
const det = { timer: null, cfg: null, worker: null, busy: false };

async function getWorker() {
  if (!det.worker) {
    const { createWorker } = require('tesseract.js');
    det.worker = await createWorker('eng', 1, { cachePath: app.getPath('userData') });
    await det.worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
  }
  return det.worker;
}

function pct(v, lo, hi, d) { return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }

async function detectOnce() {
  const c = det.cfg;
  const disp = screen.getPrimaryDisplay();
  const sf = disp.scaleFactor || 1;
  const W = Math.round(disp.size.width * sf), H = Math.round(disp.size.height * sf);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: H } });
  const src = sources.find((s) => String(s.display_id) === String(disp.id)) || sources[0];
  if (!src) return { error: 'No screen found' };
  const full = src.thumbnail, fs = full.getSize();
  const x = Math.round(fs.width * pct(c.x, 0, 99, 0) / 100), y = Math.round(fs.height * pct(c.y, 0, 99, 76) / 100);
  const w = Math.max(20, Math.min(fs.width - x, Math.round(fs.width * pct(c.w, 2, 100, 14) / 100)));
  const h = Math.max(20, Math.min(fs.height - y, Math.round(fs.height * pct(c.h, 2, 100, 24) / 100)));
  const crop = full.crop({ x, y, width: w, height: h });
  const bmp = crop.toBitmap();
  const kind = detect.classify(bmp, w, h, true);
  const out = { kind, value: 0, preview: crop.resize({ width: Math.min(220, w) }).toDataURL() };
  if (kind === 'tally') {
    const t = detect.readTally(bmp, w, h, true);
    if (t.conf >= 1 && t.value > 0) out.value = t.value;
  } else {
    const b = detect.digitsBitmap(bmp, w, h, true);
    const png = require('electron').nativeImage.createFromBitmap(b.data, { width: b.width, height: b.height }).toPNG();
    const worker = await getWorker();
    const r = await worker.recognize(png);
    const txt = (r.data.text || '').replace(/\D/g, '');
    if (txt && txt.length <= 3 && r.data.confidence >= 60) out.value = parseInt(txt, 10);
  }
  return out;
}

function stopDetect() { if (det.timer) { clearInterval(det.timer); det.timer = null; } }

ipcMain.on('detect-start', (_event, cfg) => {
  stopDetect();
  det.cfg = cfg && typeof cfg === 'object' ? cfg : {};
  const tick = async () => {
    if (det.busy || !win || win.isDestroyed()) return;
    det.busy = true;
    try {
      const res = await detectOnce();
      if (win && !win.isDestroyed()) win.webContents.send('detect-result', res);
    } catch (e) {
      if (win && !win.isDestroyed()) win.webContents.send('detect-result', { error: String(e && e.message || e).slice(0, 120) });
    } finally { det.busy = false; }
  };
  tick();
  det.timer = setInterval(tick, 1200);
});
ipcMain.on('detect-stop', stopDetect);

app.on('will-quit', () => { stopDetect(); globalShortcut.unregisterAll(); });

function checkForUpdates() {
  // Only the installed app updates itself. Running with "npm start" skips this.
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    const { dialog } = require('electron');
    autoUpdater.autoDownload = false;          // ask first
    autoUpdater.autoInstallOnAppQuit = false;  // never install without a yes
    autoUpdater.on('error', () => { /* offline or no release yet: ignore */ });
    autoUpdater.on('update-available', async (info) => {
      if (prefs.skipVersion === info.version) return;
      const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'info',
        title: 'Update available',
        message: 'BO1 Drop Tracker ' + info.version + ' is available.',
        detail: 'You are on version ' + app.getVersion() + '. Download and install the update?',
        buttons: ['Update now', 'Later', 'Skip this version'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (r.response === 0) autoUpdater.downloadUpdate().catch(() => {});
      else if (r.response === 2) { prefs.skipVersion = info.version; savePrefs(); }
    });
    autoUpdater.on('update-downloaded', async () => {
      const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'info',
        title: 'Update ready',
        message: 'The update has been downloaded.',
        detail: 'Restart now to finish installing it?',
        buttons: ['Restart now', 'Install when I close the app'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (r.response === 0) autoUpdater.quitAndInstall();
      else autoUpdater.autoInstallOnAppQuit = true;
    });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) { /* updater missing: ignore */ }
}

app.whenReady().then(() => { loadPrefs(); createWindow(); checkForUpdates(); });
app.on('window-all-closed', () => app.quit());
