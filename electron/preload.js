const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates) => ipcRenderer.invoke('settings:set', updates),
  chat: (messages) => ipcRenderer.invoke('provider:chat', messages),
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  cancelChat: () => ipcRenderer.invoke('provider:cancel'),
  listOllamaLocal: () => ipcRenderer.invoke('ollama:listLocal'),
  listOllamaRemote: () => ipcRenderer.invoke('ollama:listRemote'),
  listGeminiModels: () => ipcRenderer.invoke('gemini:listModels'),
  transcribe: (audioBuffer) => ipcRenderer.invoke('provider:transcribe', audioBuffer),
  getScreenSources: () => ipcRenderer.invoke('desktop:getSources'),
  setWindowOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setShortcutEnabled: (enabled) => ipcRenderer.invoke('shortcut:setEnabled', enabled),
  sendRecordingStatus: (isRecording) => ipcRenderer.send('renderer:recording-status', isRecording),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('provider:status', handler);
    return () => ipcRenderer.removeListener('provider:status', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },
  onDownloadProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onScreenshotCaptured: (callback) => {
    const handler = (_event, dataUrl) => callback(dataUrl);
    ipcRenderer.on('screenshot-captured', handler);
    return () => ipcRenderer.removeListener('screenshot-captured', handler);
  },
  getPersonalities: () => ipcRenderer.invoke('personalities:get'),
  savePersonalities: (personalities) => ipcRenderer.invoke('personalities:save', { personalities }),
  setActivePersonality: (id) => ipcRenderer.invoke('personalities:setActive', id),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
  summarizeMeeting: (currentSummary, newText) => ipcRenderer.invoke('meeting:summarize', currentSummary, newText)
});
