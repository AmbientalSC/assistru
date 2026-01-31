const { app, BrowserWindow, globalShortcut, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const screenshot = require('screenshot-desktop');
const { autoUpdater } = require('electron-updater');
const ProviderService = require('./providers/ProviderService');

autoUpdater.logger = console;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow;
let overlayWindow;
let shortcutWindow;
let pendingCapture = null;
let capturedFrame = null;
let activeChatController = null;

const store = new Store({
  defaults: {
    provider: 'ollama',
    groqApiKey: '',
    groqModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    openrouterApiKey: '',
    openrouterModel: 'openrouter/auto',
    geminiApiKey: '',
    geminiModel: 'gemini-2.5-flash',
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'llama3.2-vision',
    ollamaOptions: '',
    ollamaApiKey: '',
    supabaseApiKey: '',
    dbToolEnabled: true,
    windowOpacity: 0.92,
    floatingShortcutEnabled: true,
    globalShortcut: 'CommandOrControl+Shift+Space'
  }
});

const deprecatedGroqModels = new Set(['llama-3.2-11b-vision-preview']);
const groqPreferredModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
const currentGroqModel = store.get('groqModel');
if (deprecatedGroqModels.has(currentGroqModel)) {
  store.set('groqModel', groqPreferredModel);
}

const providerService = new ProviderService(store);

const normalizeOllamaBase = (raw) => {
  if (!raw) return 'http://localhost:11434';
  const trimmed = raw.trim();
  const withoutApi = trimmed.replace(/\/api\/.*$/i, '');
  return withoutApi.replace(/\/$/, '');
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 602,
    height: 709,
    transparent: true,
    frame: false,
    resizable: true,
    minWidth: 360,
    minHeight: 520,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const initialOpacity = Math.min(Math.max(Number(store.get('windowOpacity', 0.92)) || 0.92, 0.4), 1);
  mainWindow.setOpacity(initialOpacity);

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createShortcutWindow = () => {
  if (shortcutWindow) return;
  const primary = screen.getPrimaryDisplay();
  const size = 60;
  const padding = 24;
  const x = Math.round(primary.workArea.x + primary.workArea.width - size - padding);
  const y = Math.round(primary.workArea.y + padding);

  shortcutWindow = new BrowserWindow({
    width: size,
    height: size,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'shortcutPreload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  shortcutWindow.setAlwaysOnTop(true, 'floating');
  shortcutWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  shortcutWindow.loadFile(path.join(__dirname, 'shortcut.html'));

  shortcutWindow.on('closed', () => {
    shortcutWindow = null;
  });
};

const destroyShortcutWindow = () => {
  if (shortcutWindow) {
    shortcutWindow.close();
    shortcutWindow = null;
  }
};

const createOverlayWindow = (display) => {
  overlayWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlayPreload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    if (pendingCapture) {
      pendingCapture.resolve(null);
      pendingCapture = null;
    }
  });
};

const toggleWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const captureDisplay = async (displayId) => {
  try {
    return await screenshot({ format: 'png', screen: displayId });
  } catch (error) {
    return screenshot({ format: 'png' });
  }
};

const finishCapture = (dataUrl) => {
  if (overlayWindow) {
    overlayWindow.close();
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  if (pendingCapture) {
    pendingCapture.resolve(dataUrl || null);
    pendingCapture = null;
  }
  capturedFrame = null;
};

app.whenReady().then(() => {
  app.setAppUserModelId('com.aether.chat');
  createWindow();
  if (store.get('floatingShortcutEnabled', true)) {
    createShortcutWindow();
  }

  globalShortcut.register(store.get('globalShortcut', 'CommandOrControl+Shift+Space'), () => {
    toggleWindow();
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('settings:get', () => {
  return store.store;
});

ipcMain.handle('settings:set', (event, updates) => {
  if (updates && typeof updates === 'object') {
    const oldShortcut = store.get('globalShortcut');
    store.set(updates);
    const newShortcut = store.get('globalShortcut');

    // Update global shortcut if changed
    if (oldShortcut !== newShortcut && newShortcut) {
      if (oldShortcut) {
        globalShortcut.unregister(oldShortcut);
      }
      try {
        globalShortcut.register(newShortcut, () => {
          toggleWindow();
        });
      } catch (err) {
        console.error('Failed to register shortcut:', newShortcut, err);
      }
    }
  }
  return store.store;
});

ipcMain.handle('ollama:listLocal', async () => {
  const base = normalizeOllamaBase(store.get('ollamaEndpoint', 'http://localhost:11434'));
  const response = await fetch(`${base}/api/tags`);
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error || 'Failed to list local Ollama models.';
    throw new Error(message);
  }
  return data?.models || [];
});

ipcMain.handle('ollama:listRemote', async () => {
  const apiKey = store.get('ollamaApiKey', '');
  const headers = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch('https://ollama.com/api/tags', { headers });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error || 'Failed to list Ollama library models.';
    throw new Error(message);
  }
  return data?.models || [];
});

ipcMain.handle('gemini:listModels', async () => {
  const apiKey = store.get('geminiApiKey', '');
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Add it in Settings.');
  }
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: {
      'x-goog-api-key': apiKey
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || data?.error || 'Failed to list Gemini models.';
    throw new Error(message);
  }
  return data?.models || [];
});

ipcMain.handle('provider:chat', async (event, messages) => {
  if (activeChatController) {
    activeChatController.abort();
  }
  const controller = new AbortController();
  activeChatController = controller;
  const sendStatus = (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('provider:status', payload);
    }
  };
  sendStatus({ stage: 'thinking' });
  try {
    const result = await providerService.chat(messages || [], controller.signal, sendStatus);
    sendStatus({ stage: 'done' });
    return result;
  } finally {
    if (activeChatController === controller) {
      activeChatController = null;
    }
  }
});

ipcMain.handle('capture-screenshot', async () => {
  if (pendingCapture) return null;
  if (!mainWindow) return null;

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);

  mainWindow.hide();
  await delay(150);

  const buffer = await captureDisplay(display.id);
  const image = nativeImage.createFromBuffer(buffer);
  const imageSize = image.getSize();
  const scaleFactor = imageSize.width / display.bounds.width;

  capturedFrame = {
    buffer,
    imageSize,
    scaleFactor: scaleFactor || display.scaleFactor || 1
  };

  return new Promise((resolve) => {
    pendingCapture = { resolve };
    createOverlayWindow(display);

    overlayWindow.webContents.once('did-finish-load', () => {
      overlayWindow.webContents.send('overlay:init', {
        dataUrl: `data:image/png;base64,${buffer.toString('base64')}`
      });
    });
  });
});

ipcMain.handle('window:hide', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
  return true;
});

ipcMain.handle('window:close', () => {
  app.quit();
});

ipcMain.handle('provider:cancel', () => {
  if (activeChatController) {
    activeChatController.abort();
    activeChatController = null;
    return true;
  }
  return false;
});

ipcMain.handle('window:setOpacity', (event, value) => {
  const nextOpacity = Math.min(Math.max(Number(value) || 1, 0.4), 1);
  store.set('windowOpacity', nextOpacity);
  if (mainWindow) {
    mainWindow.setOpacity(nextOpacity);
  }
  return nextOpacity;
});

ipcMain.handle('shortcut:setEnabled', (event, enabled) => {
  const next = Boolean(enabled);
  store.set('floatingShortcutEnabled', next);
  if (next) {
    createShortcutWindow();
  } else {
    destroyShortcutWindow();
  }
  return next;
});

ipcMain.on('shortcut:toggle', () => {
  toggleWindow();
});

ipcMain.on('shortcut:move', (event, position) => {
  if (!shortcutWindow || !position) return;
  const x = Math.round(Number(position.x));
  const y = Math.round(Number(position.y));
  if (Number.isNaN(x) || Number.isNaN(y)) return;
  shortcutWindow.setPosition(x, y);
});

ipcMain.on('overlay:selection', (event, rect) => {
  if (!pendingCapture || !capturedFrame) return;
  if (!rect || rect.width < 2 || rect.height < 2) {
    finishCapture(null);
    return;
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const image = nativeImage.createFromBuffer(capturedFrame.buffer);
  const scale = capturedFrame.scaleFactor || 1;

  const cropX = Math.round(rect.x * scale);
  const cropY = Math.round(rect.y * scale);
  const cropW = Math.round(rect.width * scale);
  const cropH = Math.round(rect.height * scale);

  const x = clamp(cropX, 0, capturedFrame.imageSize.width - 1);
  const y = clamp(cropY, 0, capturedFrame.imageSize.height - 1);
  const width = clamp(cropW, 1, capturedFrame.imageSize.width - x);
  const height = clamp(cropH, 1, capturedFrame.imageSize.height - y);

  const cropped = image.crop({ x, y, width, height });
  finishCapture(cropped.toDataURL());
});

ipcMain.on('overlay:cancel', () => {
  finishCapture(null);
});
