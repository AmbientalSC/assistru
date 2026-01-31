const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),
  chat: (messages) => ipcRenderer.invoke('provider:chat', messages),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  cancelChat: () => ipcRenderer.invoke('provider:cancel'),
  listOllamaLocal: () => ipcRenderer.invoke('ollama:listLocal'),
  listOllamaRemote: () => ipcRenderer.invoke('ollama:listRemote'),
  listGeminiModels: () => ipcRenderer.invoke('gemini:listModels'),
  setWindowOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setShortcutEnabled: (enabled) => ipcRenderer.invoke('shortcut:setEnabled', enabled),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('provider:status', handler);
    return () => ipcRenderer.removeListener('provider:status', handler);
  }
});
