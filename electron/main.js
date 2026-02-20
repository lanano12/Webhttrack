/**
 * HTTrack Desktop GUI (Electron)
 * Launches htsserver (web UI) and shows it in a window.
 * UI is the existing browser-based GUI; a Tauri version could reuse the same backend (htsserver) later.
 */

const { app, BrowserWindow, BrowserView, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const DEFAULT_PORT = 8080;
const SERVER_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 200;
/** Match htsserver output: URL=http://HOST:PORT/ */
const SERVER_URL_REGEX = /URL=http:\/\/[^/:]+:(\d+)\//;

/** Repo root: parent of this electron/ folder */
const REPO_ROOT = path.resolve(__dirname, '..');
const HTSSERVER_EXE = path.join(REPO_ROOT, 'src', 'htsserver.exe');
/** Server needs path with trailing separator to find lang.def and html/ */
const HTSSERVER_CWD = REPO_ROOT + path.sep;

const DEFAULT_BROWSER_URL = 'https://lucisqr.substack.com/';
/** Height of the URL bar row in the wrapper (px). Must match wrapper.css */
const BROWSER_BAR_HEIGHT = 48;
/** Column width ratio: HTTrack and Browser each use this fraction. */
const COL_RATIO = 0.42;

let serverProcess = null;
let mainWindow = null;
let browserView = null;

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

/**
 * Spawn htsserver and resolve with the port it actually bound to (from its "URL=..." output).
 * htsserver may use 8081, 8082, etc. if 8080 is in use.
 */
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

  let outBuf = '';
  let errBuf = '';

  function checkForPort(buf) {
    const m = buf.match(SERVER_URL_REGEX);
    return m ? parseInt(m[1], 10) : null;
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('htsserver did not print URL in time. Check that a port in the 8080 range is free.'));
    }, SERVER_WAIT_MS);

    function maybeResolve(port) {
      if (port != null) {
        clearTimeout(timeout);
        resolve(port);
      }
    }

    serverProcess.stdout.on('data', (d) => {
      const s = d.toString();
      process.stdout.write(s);
      outBuf += s;
      maybeResolve(checkForPort(outBuf));
    });
    serverProcess.stderr.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(s);
      errBuf += s;
      maybeResolve(checkForPort(errBuf));
    });
    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    serverProcess.on('exit', (code, signal) => {
      serverProcess = null;
      if (code !== null && code !== 0) console.error('htsserver exited with code', code);
    });
  });
}

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

function updateBrowserViewBounds(win) {
  if (!browserView || !win || win.isDestroyed()) return;
  const [w, h] = win.getSize();
  const x = Math.floor(w * COL_RATIO);
  const width = Math.floor(w * COL_RATIO);
  const y = BROWSER_BAR_HEIGHT;
  const height = Math.max(0, h - BROWSER_BAR_HEIGHT);
  browserView.setBounds({ x, y, width, height });
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1400,
    height: 800,
    title: 'HTTrack Website Copier',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  ipcMain.handle('open-external', (_, url) => {
    if (url && typeof url === 'string') shell.openExternal(url);
  });
  ipcMain.handle('browser-load-url', (_, url) => {
    if (browserView && url && typeof url === 'string') {
      browserView.webContents.loadURL(url).catch((err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser-load-status', 'failed', err.message || String(err));
        }
      });
    }
  });
  ipcMain.handle('browser-capture-screenshot', async () => {
    if (!browserView || !mainWindow || mainWindow.isDestroyed()) return { canceled: true };
    try {
      const img = await browserView.webContents.capturePage();
      const png = img.toPNG();
      const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save screenshot',
        defaultPath: `screenshot-${Date.now()}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (canceled || !filePath) return { canceled: true };
      fs.writeFileSync(filePath, png);
      return { canceled: false, path: filePath };
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-load-status', 'screenshot-error', err.message || String(err));
      }
      return { canceled: true, error: err.message };
    }
  });

  browserView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.setBrowserView(browserView);
  updateBrowserViewBounds(win);
  win.on('resize', () => updateBrowserViewBounds(win));

  browserView.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-load-status', 'loaded');
      mainWindow.webContents.send('browser-url-changed', browserView.webContents.getURL());
    }
  });
  browserView.webContents.on('did-fail-load', (_, code, desc, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser-load-status', 'failed', desc || `code ${code}`);
    }
  });
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  browserView.webContents.loadURL(DEFAULT_BROWSER_URL).catch(() => {});

  win.loadFile(path.join(__dirname, 'wrapper.html'), {
    query: { server: serverUrl(port) },
  });
  win.on('closed', () => {
    browserView = null;
    mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow = win;
}

app.whenReady().then(async () => {
  try {
    const port = await spawnServer();
    const ok = await waitForServer(port, SERVER_WAIT_MS);
    if (!ok) {
      console.error('Server did not respond in time on port', port);
      app.quit();
      return;
    }
    createWindow(port);
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
