const { app, BrowserWindow, Menu, globalShortcut, Notification, Tray, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let tray;
const isDev = process.env.NODE_ENV === 'development';
const WEB_URL = isDev ? 'http://localhost:8081' : `file://${path.join(__dirname, '../web-build/index.html')}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 780,
    minWidth: 360,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#FFFFFF',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  mainWindow.loadURL(WEB_URL);

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('DayFlow');
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function setupMenu() {
  const template = [
    {
      label: 'DayFlow',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'Cmd+,', click: () => {} },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit DayFlow',
          accelerator: 'Cmd+Q',
          click: () => { app.isQuitting = true; app.quit(); },
        },
      ],
    },
    {
      label: 'Tasks',
      submenu: [
        {
          label: 'New Task',
          accelerator: 'Cmd+N',
          click: () => {
            if (mainWindow) mainWindow.webContents.executeJavaScript('window.__dayflowNewTask && window.__dayflowNewTask()');
          },
        },
        {
          label: 'Complete Task',
          accelerator: 'Cmd+Return',
          click: () => {
            if (mainWindow) mainWindow.webContents.executeJavaScript('window.__dayflowCompleteTask && window.__dayflowCompleteTask()');
          },
        },
        { type: 'separator' },
        {
          label: 'Daily Briefing',
          accelerator: 'Cmd+D',
          click: () => {
            if (mainWindow) mainWindow.webContents.executeJavaScript('window.__dayflowBriefing && window.__dayflowBriefing()');
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
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
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  if (isDev) {
    template[3].submenu.push({ role: 'toggleDevTools' });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Auto-launch
function setAutoLaunch(enable) {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: true,
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupMenu();

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
  });
});

// Without this, the close handler above keeps hiding the window and the app
// never actually exits on Cmd+Q or a dock quit.
app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Native notifications bridge
app.on('ready', () => {
  if (Notification.isSupported()) {
    // Notifications handled by the web app via Expo Notifications
  }
});
