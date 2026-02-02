const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortcutApi', {
  toggle: () => ipcRenderer.send('shortcut:toggle'),
  moveTo: (x, y) => ipcRenderer.send('shortcut:move', { x, y }),
  onRecordingStatus: (callback) => ipcRenderer.on('main:recording-status', (_, val) => callback(val))
});
