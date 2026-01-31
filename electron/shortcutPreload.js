const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortcutApi', {
  toggle: () => ipcRenderer.send('shortcut:toggle'),
  moveTo: (x, y) => ipcRenderer.send('shortcut:move', { x, y })
});
