'use strict';

const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// DayFlow as a Mac application.
//
// A window around the hosted app rather than a copy of it. That way the desktop
// app is never a version behind the phone, and the service worker means it
// still opens without a connection once it has run at least once.
//
// Everything that makes DayFlow work — the encryption, the Supabase sync — is
// the app's own. This process adds a Dock icon, a real window and a menu, and
// otherwise stays out of the way.

const APP_URL = process.env.DAYFLOW_URL || 'https://twdashenafi-beep.github.io/Claude/';
const ORIGIN = new URL(APP_URL).origin;

// Window size and position, so the app opens where it was left.
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // A screen that is no longer attached would put the window out of reach.
    const visible = screen.getAllDisplays().some(d => {
      const b = d.workArea;
      return saved.x < b.x + b.width && saved.x + saved.width > b.x
        && saved.y < b.y + b.height && saved.y + saved.height > b.y;
    });
    return visible ? saved : null;
  } catch {
    return null;
  }
}

function saveState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds()));
  } catch {
    // Losing the window position is not worth interrupting anyone over.
  }
}

function createWindow() {
  const saved = readState();

  const win = new BrowserWindow({
    width: saved?.width || 1100,
    height: saved?.height || 820,
    x: saved?.x,
    y: saved?.y,
    minWidth: 380,
    minHeight: 520,
    title: 'DayFlow',
    backgroundColor: '#EDEAE2',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // Anything that is not the app itself belongs in the browser, not in here.
  const externally = url => {
    if (new URL(url).origin === ORIGIN) return false;
    shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    externally(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (externally(url)) event.preventDefault();
  });

  // A first run with no connection would otherwise be a blank window.
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    win.webContents.executeJavaScript(`
      document.body.innerHTML = \`
        <div style="font:15px -apple-system,system-ui,sans-serif;color:#3A362C;
                    display:flex;align-items:center;justify-content:center;
                    height:100vh;text-align:center;padding:40px">
          <div>
            <p style="font-size:19px;margin:0 0 8px">DayFlow could not load</p>
            <p style="color:#7A7466;margin:0 0 20px">${description}</p>
            <button onclick="location.reload()"
                    style="font:inherit;padding:9px 20px;border:0;border-radius:6px;
                           background:#3A362C;color:#fff;cursor:pointer">Try again</button>
          </div>
        </div>\`;
    `).catch(() => {});
  });

  let pending = null;
  const remember = () => {
    clearTimeout(pending);
    pending = setTimeout(() => saveState(win), 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => { clearTimeout(pending); saveState(win); });

  return win;
}

// Without a menu there are no keyboard shortcuts at all — no copy, no paste,
// no quit — because those come from the menu on macOS.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.setName('DayFlow');

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // On macOS, clicking the Dock icon with no window open should open one.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
