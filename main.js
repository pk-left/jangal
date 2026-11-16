const { app, BrowserWindow, ipcMain, Notification, dialog, shell, powerMonitor, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(app.getPath('userData'), 'jangal-data.json');

// Jangal was called Lumen until 2.3. On the first run after the rename, carry the old
// data folder across (study history, settings and daily backups) so nothing resets.
(function migrateFromLumen() {
  try {
    if (fs.existsSync(DATA_FILE)) return;
    const oldDir = path.join(app.getPath('appData'), 'Lumen');
    const oldFile = path.join(oldDir, 'lumen-data.json');
    if (!fs.existsSync(oldFile)) return;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.copyFileSync(oldFile, DATA_FILE);
    const oldBackups = path.join(oldDir, 'backups');
    if (fs.existsSync(oldBackups)) fs.cpSync(oldBackups, path.join(path.dirname(DATA_FILE), 'backups'), { recursive: true, force: false });
  } catch (e) {
    console.error('Could not bring data across from Lumen', e);
  }
})();
const FULL = { width: 1240, height: 800, minWidth: 900, minHeight: 600 };
const MINI = { width: 300, height: 380 };
const HEX = /^#[0-9a-f]{3,8}$/i;

// Title-bar colours follow the theme chosen in the app.
let chrome = { bg: '#0f0f0e', fg: '#c3c2b7' };
function setChrome(c) {
  if (c && HEX.test(c.bg) && HEX.test(c.fg)) chrome = { bg: c.bg, fg: c.fg };
}
const overlay = (height) => ({ color: chrome.bg, symbolColor: chrome.fg, height });

let win = null;
let savedBounds = null;
let isMini = false;

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Write to a temp file first so a crash mid-write never corrupts the history.
function writeData(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);
}

function backupOncePerDay(data) {
  if (!data) return;
  const dir = path.join(app.getPath('userData'), 'backups');
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `jangal-${stamp}.json`);
  if (fs.existsSync(file)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  // keep the 14 most recent backups
  const files = fs.readdirSync(dir).filter((f) => /^(jangal|lumen)-/.test(f)).sort();
  files.slice(0, Math.max(0, files.length - 14)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
}

function createWindow() {
  // Never open larger than the screen (common 1366x768 laptops are shorter than the default size).
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(FULL.width, area.width),
    height: Math.min(FULL.height, area.height),
    minWidth: Math.min(FULL.minWidth, area.width),
    minHeight: Math.min(FULL.minHeight, area.height),
    show: false,
    backgroundColor: chrome.bg,
    title: 'Jangal',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(44),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.pkleft.jangal');
    const data = readData();
    backupOncePerDay(data);
    setChrome(data && data.settings && data.settings.chrome);
    createWindow();
    // Sleep should never count as study time.
    powerMonitor.on('suspend', () => win && win.webContents.send('system:suspend'));
  });
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => writeData(data));
ipcMain.on('data:saveSync', (e, data) => {
  try {
    writeData(data);
    e.returnValue = true;
  } catch {
    e.returnValue = false;
  }
});

ipcMain.on('notify', (_e, { title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true, icon: path.join(__dirname, 'build', 'icon.png') });
  n.on('click', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  n.show();
});

ipcMain.on('progress', (_e, value) => {
  if (win) win.setProgressBar(value < 0 ? -1 : value);
});

ipcMain.on('win:chrome', (_e, colors) => {
  setChrome(colors);
  if (!win) return;
  win.setBackgroundColor(chrome.bg);
  win.setTitleBarOverlay(overlay(isMini ? 36 : 44));
});

ipcMain.handle('win:mini', (_e, on) => {
  if (!win || on === isMini) return isMini;
  isMini = on;
  if (on) {
    savedBounds = win.getBounds();
    win.setMinimumSize(MINI.width, MINI.height);
    win.setSize(MINI.width, MINI.height, true);
    win.setAlwaysOnTop(true, 'floating');
    win.setTitleBarOverlay(overlay(36));
  } else {
    win.setAlwaysOnTop(false);
    const area = screen.getPrimaryDisplay().workAreaSize;
    win.setMinimumSize(Math.min(FULL.minWidth, area.width), Math.min(FULL.minHeight, area.height));
    if (savedBounds) win.setBounds(savedBounds, true);
    win.setTitleBarOverlay(overlay(44));
  }
  return isMini;
});

ipcMain.handle('file:export', async (_e, { content, name, ext }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content);
  return true;
});

ipcMain.handle('file:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return null;
  return fs.readFileSync(filePaths[0], 'utf8');
});
