# HTTrack Desktop GUI (Electron)

Desktop wrapper around the HTTrack web GUI. It starts **htsserver** and opens its URL in an Electron window.

## Prerequisites

- Node.js (LTS)
- HTTrack built with htsserver: from repo root in MSYS2, run  
  `./configure --prefix=/usr/local --with-zlib=/mingw64 --disable-shared && make -j8`  
  so that `../src/htsserver.exe` exists.

## Run

```bash
cd electron
npm install
npm start
```

## Tauri later

The UI is the existing browser-based GUI served by htsserver; no Electron-specific APIs are used in that UI. A future Tauri app can reuse the same flow: spawn htsserver with the project root path and open the same URL in a WebView.
