const { app, BrowserWindow, globalShortcut, ipcMain, screen, nativeImage, session, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const screenshot = require('screenshot-desktop');
const { autoUpdater } = require('electron-updater');
const ProviderService = require('./providers/ProviderService');
const FirebaseService = require('./services/FirebaseService');

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

  // Define default personality outside store to be accessible for migration
  const defaultPersonality = {
    id: 'default-residuos',
    name: 'Resíduos (Padrão)',
    prompt: `Você é um assistente técnico especializado da Ambiental Limpeza Urbana / Ambiental SC.
Sua função é atuar como um filtro inteligente e operacional entre dados brutos, bancos de dados internos e atendentes humanos, SEM usar conhecimento externo.

Você possui TRÊS MODOS DE OPERAÇÃO:
1) FORMATAÇÃO DE E-MAIL (RETAGUARDA)
2) CONSULTA DE COLETA DE LIXO
3) CONSULTA TÉCNICA DE MATERIAIS

Antes de qualquer ação, você DEVE identificar automaticamente qual modo aplicar com base na intenção do texto recebido.

---

# ROTEADOR DE INTENÇÃO (OBRIGATÓRIO)
Analise a entrada e classifique:

- Se o texto contém:
  • dados de cliente
  • solicitação de serviço
  • pedido de geração de e-mail
  • menção a atendimento, protocolo, solicitação formal  
→ Ative o **MODO 1 – FORMATAÇÃO DE E-MAIL**

- Se o texto contém:
  • pergunta sobre dia/horário de coleta, "quando passa o lixo", endereços para verificar coleta
→ Ative o **MODO 2 – CONSULTA DE COLETA DE LIXO**

- Se o texto contém:
  • pergunta sobre descarte, material, resíduo
  • consulta técnica, "onde jogo fora", "como descartar"
→ Ative o **MODO 3 – CONSULTA TÉCNICA DE MATERIAIS**

Nunca execute os dois modos ao mesmo tempo.

---

## 🔹 MODO 1 – FORMATAÇÃO DE E-MAIL (RETAGUARDA)

### Objetivo
Processar dados brutos fornecidos por atendentes e gerar e-mails padronizados a partir de templates internos.

### Fluxo de Trabalho
1. **ANÁLISE E BUSCA**
   - Identifique o serviço solicitado.
   - Extraia keywords e variáveis.
   - Chame a ferramenta \`fetchTemplates\`.

2. **VALIDAÇÃO DE CAMPOS**
   - Compare os dados recebidos com as \`{{variáveis}}\` exigidas pelo template.

3. **VERIFICAÇÃO DE LACUNAS**
   - Se faltarem informações:
     Pergunte EXATAMENTE:
     "Faltam as seguintes informações: [LISTA]. Deseja fornecê-las, declarar que não possui ou prosseguir com o que temos?"
   - Se o atendente fornecer dados → atualize.
   - Se disser "não possui" ou "nenhuma" → preencher com \`[NÃO INFORMADO]\`.
   - Se tudo estiver completo → prossiga.

4. **REGRAS DE FORMATAÇÃO**
   - Defina \`{{SR}}\` como:
     • "O Sr." ou "A Sra." conforme o nome.
   - Para \`{{Solicitante}}\`:
     • Se não informado, validar se é "Próprio" ou "Terceiro".

5. **FORMATO DE SAÍDA FINAL**
   - Quando autorizado:
     → Retorne EXCLUSIVAMENTE o e-mail final dentro de um **Markdown Code Block (Snippet)**.
   - PROIBIDO:
     • explicações
     • saudações
     • textos fora do snippet

---

## 🔹 MODO 2 – CONSULTA DE COLETA DE LIXO

### Objetivo
Informar dias e horários de coleta domiciliar e seletiva.

### Fluxo
1. Identifique o endereço completo (Rua, Número, Cidade). Se faltar a cidade, assuma que pode ser da região mas confirme se possível.
2. Chame a ferramenta \`buscarColeta\` com o endereço.
3. Com a resposta JSON:
   - Gere OBRIGATORIAMENTE uma tabela Markdown com as colunas: | Tipo | Turno | Frequência | Horário |
   - NUNCA inclua a coluna "Observação", "Mensagem" ou "Código" na tabela.
   - O array \`orientacoes_gerais\` do JSON deve ser listado como texto simples ABAIXO da tabela (ex: "Descarte seus resíduos...").

---

## 🔹 MODO 3 – CONSULTA TÉCNICA DE MATERIAIS

### Diretrizes de Zero Alucinação
1. PROIBIDO conhecimento externo.
2. Use APENAS os dados retornados no JSON.
3. Fidelidade geográfica absoluta:
   - Se a cidade não existir no JSON, ela NÃO aparece na resposta.
4. Campos vazios:
   - Exibir: "Sem informacao cadastrada".

### Protocolo de Busca
- Autenticação via apikey automática.
- Request:
  - Use SOMENTE o parâmetro \`termo\`.
  - NUNCA envie o parâmetro cidade.
- Estratégia:
  - Identifique a palavra-chave raiz.
  - Use wildcards:
    • "air fryer" -> ilike.*air*
    • "micro-ondas" -> ilike.*micro*
    • "guarda-roupa" -> ilike.*guarda* ou ilike.*roupa*

Sempre que precisar de dados:
→ Chame a ferramenta \`buscarMateriais\` usando apenas \`{ "termo": "..." }\`.

### Protocolo de Processamento
1. Filtro semântico:
   - Manter apenas itens alinhados à intenção.
2. Filtro geográfico:
   - Agrupar resultados por cidade.

### Regras Especiais
- Capitalizar nomes.
- Para móveis e eletrônicos em **Itajaí**, incluir obrigatoriamente:
  "Recebemos gratuitamente ate 1m3/dia no pev cata treco: secretaria de obras: (47) 3348-0303 / (47) 3228-7969"

### Formato da Resposta
Para cada cidade:
[Cidade]
- Item: [Nome do material]
- Destino: [Encaminhamento]
- Obs: [Obs]
- Volumoso: [Sim/Não]

### Tabela Resumo (OBRIGATÓRIA – até 5 itens)
| Material | Adicionado Em | Volumoso? | Obs | Encaminhar Para | Cidade |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [Material] | [Data] | [Sim/Não] | [Obs] | [Destino] | [Cidade] |`
  };

  const store = new Store({
    defaults: {
      provider: 'ollama',
      groqApiKey: '',
      groqModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
      groqVisionModel: 'llama-3.2-11b-vision-preview',
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
      googleMapsApiKey: '',
      dbToolEnabled: true,
      windowOpacity: 0.99,
      floatingShortcutEnabled: true,
      globalShortcut: 'CommandOrControl+Shift+Space',
      personalities: [defaultPersonality],
      activePersonalityId: 'default-residuos'
    }
  });

  // FORCE PROMPT UPDATE (MIGRATION)
  try {
    const stored = store.get('personalities') || [];
    const defIdx = stored.findIndex(p => p.id === 'default-residuos');
    const newPrompt = defaultPersonality.prompt;

    if (defIdx !== -1) {
      if (stored[defIdx].prompt !== newPrompt) {
        console.log('[Main] Updating default prompt...');
        stored[defIdx].prompt = newPrompt;
        store.set('personalities', stored);
      }
    } else {
      stored.unshift(defaultPersonality);
      store.set('personalities', stored);
    }
  } catch (e) {
    console.error('[Main] Failed to update prompt:', e);
  }

  const deprecatedGroqModels = new Set(['llama-3.2-11b-vision-preview']);
  const groqPreferredModel = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const currentGroqModel = store.get('groqModel');
  if (deprecatedGroqModels.has(currentGroqModel)) {
    store.set('groqModel', groqPreferredModel);
  }

  const firebaseService = new FirebaseService();

  // IPC Handlers for Personalities
  ipcMain.handle('personalities:get', async () => {
    try {
      if (firebaseService.isReady()) {
        const remotePersonalities = await firebaseService.getAllPersonalities();
        if (remotePersonalities && remotePersonalities.length > 0) {
          store.set('personalities', remotePersonalities);
          console.log('[Main] Synced personalities from Firebase.');
        }
      }
    } catch (error) {
      console.warn('[Main] Failed to sync personalities from Firebase, using local cache:', error.message);
    }

    return {
      personalities: store.get('personalities'),
      activeId: store.get('activePersonalityId')
    };
  });

  ipcMain.handle('personalities:save', async (event, { personalities }) => {
    store.set('personalities', personalities); // Save to local cache first

    // Save each personality to Firebase
    if (firebaseService.isReady()) {
      try {
        const promises = personalities.map(p => firebaseService.savePersonality(p));
        await Promise.all(promises);
        console.log('[Main] Saved all personalities to Firebase.');
      } catch (error) {
        console.error('[Main] Error saving to Firebase:', error);
        // We don't throw here to avoid breaking the UI for the user, 
        // since local save succeeded. Maybe return a warning?
      }
    }
    return true;
  });

  ipcMain.handle('personalities:setActive', (event, id) => {
    store.set('activePersonalityId', id);
    return true;
  });

  // Handle window resizing (e.g., for Side Panel)
  ipcMain.handle('resize-window', async (event, width, height) => {
    if (!mainWindow) return;
    const currentBounds = mainWindow.getBounds();
    const newWidth = width || currentBounds.width;
    const newHeight = height || currentBounds.height;

    // Only resize if different
    if (newWidth !== currentBounds.width || newHeight !== currentBounds.height) {
      mainWindow.setSize(newWidth, newHeight, true); // true = animate
    }
  });

  // Handle Meeting Summarization
  ipcMain.handle('meeting:summarize', async (event, currentSummary, newText) => {
    // Create a signal for cancellation if needed (though we don't expose cancel here yet)
    const controller = new AbortController();
    try {
      const summary = await providerService.generateMeetingSummary(currentSummary, newText, controller.signal);
      return summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      return null; // Return null on error so UI can handle it (maybe append raw text as fallback)
    }
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
        label: 'Fazer Logoff',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.webContents.send('cmd:logoff');
          }
        }
      },
      { type: 'separator' },
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

    const capturedFrame = {
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
