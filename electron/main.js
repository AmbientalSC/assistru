const { app, BrowserWindow, globalShortcut, ipcMain, screen, nativeImage, session, Tray, Menu } = require('electron');
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
let tray = null;
let pendingCapture = null;
let capturedFrame = null;
let activeChatController = null;

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Alguém tentou rodar uma segunda instância, focamos na nossa janela
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // Inicialização normal se conseguiu o lock
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['media', 'display-capture', 'microphone', 'audioCapture'];
      if (allowedPermissions.includes(permission)) {
        callback(true);
      } else {
        callback(false);
      }
    });
  });

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
      globalShortcut: 'CommandOrControl+Shift+Space',
      personalities: [
        {
          id: 'default-residuos',
          name: 'Resíduos (Padrão)',
          prompt: `Voce e um analista tecnico da Ambiental Limpeza Urbana LTDA. Sua funcao e atuar como um filtro inteligente entre um banco de dados "sujo" e o usuario.

Diretrizes de zero alucinacao:
1) PROIBIDO conhecimento externo: use apenas os dados do JSON.
2) Fidelidade geografica: se o JSON nao trouxer uma cidade, ela nao existe na resposta.
3) Campos vazios: exiba "Sem informacao cadastrada".

Protocolo de busca:
- Autenticacao: header apikey injetado automaticamente.
- Request: use apenas o parametro busca_textual. NUNCA envie o parametro cidade.
- Estrategia: identifique a palavra-chave principal/raiz e substitua o resto por wildcards (*).
  Exemplos: "air fryer" -> ilike.*air*; "micro-ondas" -> ilike.*micro*; "guarda-roupa" -> ilike.*guarda* ou ilike.*roupa*.

Protocolo de processamento:
1) Filtro semantico: mantenha itens que correspondam a intencao, descarte o resto.
2) Filtro geografico: agrupe itens validos por cidade.

Formato de resposta:
- Capitalize nomes.
- Para cada cidade:
  [Cidade]
  - Item: [Nome do material]
  - Destino: [Encaminhamento]
  - Obs: [Obs]
  - Volumoso: [Sim/Não]
  - Caso seja algo relacionado a MOVEIS e ELETRONICOS (ex: celulares, impressoras, e afins) na cidade de Itajai, orientar ligar no cata treco e passar: "Recebemos gratuitamente ate 1m3/dia no pev cata treco: secretaria de obras: (47) 3348-0303 / (47) 3228-7969"

Tabela resumo obrigatoria (ate 5 itens validos):
| Material | Adicionado Em | Volumoso? | Obs | Encaminhar Para | Cidade |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [Material] | [Data] | [Sim/Não] | [Obs] | [Destino] | [Cidade] |

Sempre que precisar de dados, chame a ferramenta buscarMateriais usando apenas o parametro "termo".`
        }
      ],
      activePersonalityId: 'default-residuos'
    }
  });

  const deprecatedGroqModels = new Set(['llama-3.2-11b-vision-preview']);
  const groqPreferredModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const currentGroqModel = store.get('groqModel');
  if (deprecatedGroqModels.has(currentGroqModel)) {
    store.set('groqModel', groqPreferredModel);
  }

  // IPC Handlers for Personalities
  ipcMain.handle('personalities:get', () => {
    return {
      personalities: store.get('personalities'),
      activeId: store.get('activePersonalityId')
    };
  });

  ipcMain.handle('personalities:save', (event, { personalities }) => {
    store.set('personalities', personalities);
    return true;
  });

  ipcMain.handle('personalities:setActive', (event, id) => {
    store.set('activePersonalityId', id);
    return true;
  });

  const providerService = new ProviderService(store);

  const normalizeOllamaBase = (raw) => {
    if (!raw) return 'http://localhost:11434';
    const trimmed = raw.trim();
    const withoutApi = trimmed.replace(/\/api\/.*$/i, '');
    return withoutApi.replace(/\/$/, '');
  };

  const createTray = () => {
    const iconPath = path.join(__dirname, '../icon.ico');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Fechar',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('Ambi Chat');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      toggleWindow();
    });
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
    const size = 80;
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
      mainWindow.webContents.send('screenshot-captured', dataUrl);
    }
  };

  app.whenReady().then(() => {
    app.setAppUserModelId('com.aether.chat');

    // Permission Handling for Media Access
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['media', 'accessibility-support', 'fullscreen', 'notifications'];
      if (allowedPermissions.includes(permission)) {
        callback(true); // Approve
      } else {
        console.warn(`Permission denied: ${permission}`);
        callback(false);
      }
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      if (permission === 'media') {
        return true;
      }
      return false;
    });

    ipcMain.handle('desktop:getSources', async () => {
      const { desktopCapturer } = require('electron');
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      // Serialize to simple objects to avoid IPC issues
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        // thumbnail: s.thumbnail.toDataURL() // We don't strictly need thumbnail for now, keep payload small
      }));
    });

    // Relay recording status to shortcut window
    ipcMain.on('renderer:recording-status', (event, isRecording) => {
      if (shortcutWindow && !shortcutWindow.isDestroyed()) {
        shortcutWindow.webContents.send('main:recording-status', isRecording);
      }
    });

    createWindow();
    createTray();

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

    autoUpdater.on('download-progress', (progressObj) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progressObj);
      }
    });

    autoUpdater.on('update-downloaded', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded');
      }
    });

    ipcMain.handle('update:install', () => {
      app.isQuitting = true; // Garante que vai fechar mesmo
      autoUpdater.quitAndInstall();
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // app.quit(); // Não fechar, pois queremos ficar na tray
    }
  });



  ipcMain.handle('settings:get', (event, key, defaultValue) => {
    return store.get(key, defaultValue);
  });

  ipcMain.handle('settings:set', (event, key, value) => {
    // If it's an object, it's a full store update
    if (typeof key === 'object') {
      const updates = key;
      const oldShortcut = store.get('globalShortcut');
      store.set(updates);
      const newShortcut = store.get('globalShortcut');

      if (oldShortcut !== newShortcut && newShortcut) {
        globalShortcut.unregisterAll();
        try {
          globalShortcut.register(newShortcut, toggleWindow);
        } catch (e) { console.error('Failed to register shortcut', e); }
      }
      return store.store;
    }

    // Single key update
    store.set(key, value);

    if (key === 'windowOpacity' && mainWindow) {
      const opacity = Math.min(Math.max(Number(value) || 0.92, 0.4), 1);
      mainWindow.setOpacity(opacity);
    }

    if (key === 'floatingShortcutEnabled') {
      if (value) createShortcutWindow();
      else destroyShortcutWindow();
    }

    if (key === 'globalShortcut') {
      globalShortcut.unregisterAll();
      try {
        globalShortcut.register(value, toggleWindow);
      } catch (e) {
        console.error('Failed to register shortcut', e);
      }
    }
    return true;
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

  ipcMain.handle('provider:transcribe', async (event, audioBuffer) => {
    try {
      // IPC sends Uint8Array/Buffer. ProviderService expects Buffer or compatible.
      return await providerService.transcribe(audioBuffer);
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
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
}
