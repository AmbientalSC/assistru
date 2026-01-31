const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onInit: (callback) => ipcRenderer.on('overlay:init', (_event, payload) => callback(payload)),
  sendSelection: (rect) => ipcRenderer.send('overlay:selection', rect),
  cancel: () => ipcRenderer.send('overlay:cancel')
});
