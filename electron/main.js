/**
 * HTTrack Desktop GUI (Electron)
 * Launches htsserver (web UI) and shows it in a window.
 * UI is the existing browser-based GUI; a Tauri version could reuse the same backend (htsserver) later.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const DEFAULT_PORT = 8080;
const SERVER_WAIT_MS = 4000;
const POLL_INTERVAL_MS = 200;

/** Repo root: parent of this electron/ folder */
const REPO_ROOT = path.resolve(__dirname, '..');
const HTSSERVER_EXE = path.join(REPO_ROOT, 'src', 'htsserver.exe');
/** Server needs path with trailing separator to find lang.def and html/ */
const HTSSERVER_CWD = REPO_ROOT + path.sep;

let serverProcess = null;
let mainWindow = null;

function isWindows() {
  return process.platform === 'win32';
}

function serverUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function waitForServer(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function poll() {
      const req = http.get(serverUrl(port), (res) => {
        req.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(poll, POLL_INTERVAL_MS);
      });
    }
    poll();
  });
}

function spawnServer() {
  if (!fs.existsSync(HTSSERVER_EXE)) {
    throw new Error(
      `htsserver not found at ${HTSSERVER_EXE}. Build the project first (e.g. make -C src htsserver.exe in MSYS2).`
    );
  }

  const env = { ...process.env };
  if (isWindows()) {
    const mingw = process.env.MSYSTEM === 'MINGW64' ? 'C:\\msys64\\mingw64\\bin' : 'C:\\msys64\\mingw64\\bin';
    const pathVar = process.env.PATH || process.env.Path || '';
    env.PATH = mingw + path.delimiter + pathVar;
    if (process.env.Path) env.Path = env.PATH;
  }

  serverProcess = spawn(HTSSERVER_EXE, [HTSSERVER_CWD], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(d.toString()));
  serverProcess.stderr.on('data', (d) => process.stderr.write(d.toString()));
  serverProcess.on('error', (err) => {
    console.error('htsserver error:', err);
  });
  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (code !== null && code !== 0) console.error('htsserver exited with code', code);
  });
}

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1400,
    height: 800,
    title: 'HTTrack Website Copier',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, 'wrapper.html'), {
    query: { server: serverUrl(port) },
  });
  win.on('closed', () => { mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow = win;
}

app.whenReady().then(async () => {
  try {
    spawnServer();
    const ok = await waitForServer(DEFAULT_PORT, SERVER_WAIT_MS);
    if (!ok) {
      console.error('Server did not respond in time. Check that port', DEFAULT_PORT, 'is free.');
      app.quit();
      return;
    }
    createWindow(DEFAULT_PORT);
  } catch (err) {
    console.error(err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});

app.on('before-quit', () => {
  killServer();
});
