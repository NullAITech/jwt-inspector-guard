const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// 1. Linux & VM GPU Safeguards
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
app.commandLine.appendSwitch('ozone-platform', 'x11');

app.on('child-process-gone', (event, details) => {
  if (details.type === 'GPU') {
    console.log('[JWT-Guard] GPU process fallback to software rendering');
  }
});

let mainWindow = null;
let backendProcess = null;
const BACKEND_PORT = 8080;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

function isBackendRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startBackend() {
  const rootDir = path.resolve(__dirname, '..');
  const srcDir = path.join(rootDir, 'src');
  console.log(`[JWT-Guard] Spawning backend daemon on port ${BACKEND_PORT}...`);
  
  backendProcess = spawn('python3', ['-m', 'jwt_inspector_guard.cli', 'serve', '--port', String(BACKEND_PORT), '--no-browser'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH ? `${srcDir}:${process.env.PYTHONPATH}` : srcDir,
      PYTHONUNBUFFERED: '1',
      ZOTH_ZERO_EGRESS: 'true',
    },
  });

  backendProcess.on('error', (err) => {
    console.error('[JWT-Guard] Failed to start backend:', err);
  });
}

async function waitForBackend(maxAttempts = 40, interval = 250) {
  for (let i = 0; i < maxAttempts; i++) {
    const alive = await isBackendRunning();
    if (alive) {
      console.log('[JWT-Guard] Backend daemon is online and responsive.');
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#08080B',
    title: 'JWT Inspector Guard // Zero-Egress Cryptographic Security Workstation',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const alreadyRunning = await isBackendRunning();
  if (!alreadyRunning) {
    startBackend();
    await waitForBackend();
  } else {
    console.log(`[JWT-Guard] Backend already running on port ${BACKEND_PORT}.`);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    try {
      backendProcess.kill('SIGTERM');
      console.log('[JWT-Guard] Terminated background backend daemon.');
    } catch (e) {
      // ignore
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
