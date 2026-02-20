const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openInBrowser: (url) => ipcRenderer.invoke('open-external', url),
  browserLoadUrl: (url) => ipcRenderer.invoke('browser-load-url', url),
  onBrowserLoadStatus: (callback) => {
    ipcRenderer.on('browser-load-status', (_, status, detail) => callback(status, detail));
  },
  onBrowserUrlChanged: (callback) => {
    ipcRenderer.on('browser-url-changed', (_, url) => callback(url));
  },
});
