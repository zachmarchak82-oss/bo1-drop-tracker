const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getPrefs: () => ipcRenderer.invoke('get-prefs'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('set-always-on-top', flag === true),
  setTransparent: (flag) => ipcRenderer.send('set-transparent', flag === true),
  minimize: () => ipcRenderer.send('win-minimize'),
  close: () => ipcRenderer.send('win-close'),
  setHotkeys: (cfg) => ipcRenderer.invoke('set-hotkeys', cfg),
  detectStart: (cfg) => ipcRenderer.send('detect-start', cfg),
  detectStop: () => ipcRenderer.send('detect-stop'),
  onDetect: (cb) => ipcRenderer.on('detect-result', (_event, res) => cb(res)),
  onRoundStep: (cb) => ipcRenderer.on('round-step', (_event, step) => cb(step === 1 ? 1 : -1))
});
