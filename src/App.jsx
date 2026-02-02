import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Settings,
  Camera,
  SendHorizontal,
  Cpu,
  Cloud,
  X,
  RefreshCcw,
  Minus,
  Power,
  Square,
  Monitor,
  Mic
} from 'lucide-react';

const defaultSettings = {
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
};

const groqModelOptions = [
  { label: 'Llama 4 Scout 17B 16E', value: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { label: 'Llama Guard 4 12B', value: 'meta-llama/llama-guard-4-12b' },
  { label: 'Llama 3.1 8B Instant', value: 'llama-3.1-8b-instant' },
  { label: 'Llama 3.3 70B Versatile', value: 'llama-3.3-70b-versatile' },
  { label: 'GPT OSS 20B', value: 'openai/gpt-oss-20b' },
  { label: 'GPT OSS 120B', value: 'openai/gpt-oss-120b' }
];

const ollamaOptionPresets = [
  {
    label: 'Balanced (2K ctx)',
    value: '{"num_ctx":2048}'
  },
  {
    label: 'More GPU (2K ctx)',
    value: '{"num_ctx":2048,"num_gpu":32}'
  },
  {
    label: 'Low VRAM (1K ctx)',
    value: '{"num_ctx":1024,"num_gpu":8}'
  }
];

const visionNameHints = ['vision', 'llava', 'minicpm', 'moondream', 'qwen-vl', 'qwen2-vl', 'phi-vision'];

const formatStatus = (provider) => (provider === 'ollama' ? 'Local' : 'Nuvem');

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const detectVision = (modelName, details) => {
  const name = (modelName || '').toLowerCase();
  if (visionNameHints.some((hint) => name.includes(hint))) return true;
  const family = (details?.family || '').toLowerCase();
  if (family.includes('mllama')) return true;
  const families = Array.isArray(details?.families) ? details.families.map((f) => String(f).toLowerCase()) : [];
  if (families.some((f) => f.includes('mllama') || f.includes('clip'))) return true;
  if (details?.projector) return true;
  return false;
};

const normalizeGeminiModelId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^models\//i, '').trim().toLowerCase();
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [transcriptionPreview, setTranscriptionPreview] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioError, setAudioError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);

  const audioStreamRef = useRef(null);
  const batchChunksRef = useRef([]);
  const transcriptionIntervalRef = useRef(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const [localOllamaModels, setLocalOllamaModels] = useState([]);
  const [remoteOllamaModels, setRemoteOllamaModels] = useState([]);
  const [ollamaSearch, setOllamaSearch] = useState('');
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [ollamaLocalError, setOllamaLocalError] = useState('');
  const [ollamaRemoteError, setOllamaRemoteError] = useState('');
  const [geminiModels, setGeminiModels] = useState([]);
  const [geminiSearch, setGeminiSearch] = useState('');
  const [isLoadingGeminiModels, setIsLoadingGeminiModels] = useState(false);
  const [geminiModelsError, setGeminiModelsError] = useState('');
  const [statusStage, setStatusStage] = useState('thinking');
  const [activeToolName, setActiveToolName] = useState('');
  const activeRequestId = useRef(0);

  const providerLabel = useMemo(() => formatStatus(settings.provider), [settings.provider]);
  const groqSelectValue = useMemo(() => {
    return groqModelOptions.some((option) => option.value === settings.groqModel)
      ? settings.groqModel
      : '__custom__';
  }, [settings.groqModel]);
  const normalizedGeminiModelId = useMemo(
    () => normalizeGeminiModelId(settings.geminiModel),
    [settings.geminiModel]
  );
  const geminiModelOptions = useMemo(() => {
    const list = Array.isArray(geminiModels) ? geminiModels : [];
    const options = list
      .filter((model) => {
        const methods = Array.isArray(model?.supportedGenerationMethods)
          ? model.supportedGenerationMethods
          : [];
        return methods.length === 0 || methods.includes('generateContent');
      })
      .map((model) => {
        const rawName = model?.name || '';
        const id = rawName.replace(/^models\//i, '');
        if (!id) return null;
        const label = model?.displayName ? `${model.displayName} (${id})` : id;
        return { id, idLower: id.toLowerCase(), label };
      })
      .filter(Boolean);
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [geminiModels]);
  const geminiSelectValue = useMemo(() => {
    const match = geminiModelOptions.find((option) => option.idLower === normalizedGeminiModelId);
    return match ? match.id : '__custom__';
  }, [geminiModelOptions, normalizedGeminiModelId]);
  const filteredGeminiModels = useMemo(() => {
    const query = geminiSearch.trim().toLowerCase();
    const list = geminiModelOptions.filter((option) => {
      if (!query) return true;
      return option.label.toLowerCase().includes(query) || option.idLower.includes(query);
    });
    const limited = list.slice(0, 50);
    const selected = geminiModelOptions.find((option) => option.idLower === normalizedGeminiModelId);
    if (selected && !limited.some((option) => option.idLower === selected.idLower)) {
      return [selected, ...limited].slice(0, 50);
    }
    return limited;
  }, [geminiModelOptions, geminiSearch, normalizedGeminiModelId]);
  const localOllamaNames = useMemo(
    () => localOllamaModels.map((model) => model.name).filter(Boolean),
    [localOllamaModels]
  );
  const remoteOllamaNames = useMemo(
    () => remoteOllamaModels.map((model) => model.name).filter(Boolean),
    [remoteOllamaModels]
  );
  const combinedOllamaNames = useMemo(() => {
    const all = [...localOllamaNames, ...remoteOllamaNames];
    return Array.from(new Set(all));
  }, [localOllamaNames, remoteOllamaNames]);
  const ollamaSelectValue = useMemo(() => {
    return combinedOllamaNames.includes(settings.ollamaModel)
      ? settings.ollamaModel
      : '__custom__';
  }, [combinedOllamaNames, settings.ollamaModel]);
  const filteredRemoteOllama = useMemo(() => {
    const query = ollamaSearch.trim().toLowerCase();
    const list = remoteOllamaModels.filter((model) => {
      const name = (model.name || '').toLowerCase();
      return query.length === 0 ? true : name.includes(query);
    });
    return query.length === 0 ? list.slice(0, 50) : list.slice(0, 50);
  }, [remoteOllamaModels, ollamaSearch]);
  const selectedOllamaModel = useMemo(() => {
    return (
      localOllamaModels.find((model) => model.name === settings.ollamaModel) ||
      remoteOllamaModels.find((model) => model.name === settings.ollamaModel) ||
      null
    );
  }, [localOllamaModels, remoteOllamaModels, settings.ollamaModel]);
  const ollamaSizeLabel = useMemo(() => {
    return selectedOllamaModel?.size ? formatBytes(selectedOllamaModel.size) : '';
  }, [selectedOllamaModel]);
  const ollamaCapabilityLabel = useMemo(() => {
    const isVision = detectVision(settings.ollamaModel, selectedOllamaModel?.details);
    return isVision ? 'image + text' : 'text';
  }, [selectedOllamaModel, settings.ollamaModel]);
  const activeOllamaPreset = useMemo(() => {
    const trimmed = (settings.ollamaOptions || '').trim();
    return ollamaOptionPresets.find((preset) => preset.value === trimmed)?.label || null;
  }, [settings.ollamaOptions]);
  const isOllamaOptionsValid = useMemo(() => {
    const raw = settings.ollamaOptions;
    if (!raw || raw.trim().length === 0) return true;
    try {
      JSON.parse(raw);
      return true;
    } catch (error) {
      return false;
    }
  }, [settings.ollamaOptions]);
  const opacityValue = useMemo(() => {
    const value = Number(settings.windowOpacity);
    if (Number.isNaN(value)) return 0.92;
    return Math.min(Math.max(value, 0.4), 1);
  }, [settings.windowOpacity]);
  const opacityLabel = useMemo(() => `${Math.round(opacityValue * 100)}%`, [opacityValue]);
  const thinkingLabel = useMemo(() => {
    if (statusStage === 'tool') {
      if (activeToolName === 'buscarMateriais') {
        return 'Consultando base de dados...';
      }
      return 'Executando ferramenta...';
    }
    return 'Ambi está pensando...';
  }, [statusStage, activeToolName]);

  const markdownComponents = useMemo(
    () => ({
      table: ({ children }) => (
        <table className="w-full border-collapse text-[11px] text-slate-100/90">
          {children}
        </table>
      ),
      thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => <tr className="border-b border-white/10">{children}</tr>,
      th: ({ children }) => (
        <th className="px-2 py-1 text-left font-semibold text-slate-200/90">{children}</th>
      ),
      td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
      p: ({ children }) => (
        <p className="whitespace-pre-wrap leading-snug text-slate-100/90">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="ml-4 list-disc space-y-0.5 leading-snug text-slate-100/90">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="ml-4 list-decimal space-y-0.5 leading-snug text-slate-100/90">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="whitespace-pre-wrap leading-snug">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
      em: ({ children }) => <em className="text-slate-200/90">{children}</em>,
      code: ({ inline, children }) =>
        inline ? (
          <code className="rounded bg-white/10 px-1 py-0.5 text-[11px]">{children}</code>
        ) : (
          <code className="block rounded bg-black/40 p-2 text-[11px]">{children}</code>
        )
    }),
    []
  );

  useEffect(() => {
    let active = true;
    if (!window.api) return undefined;

    window.api.getSettings().then((stored) => {
      if (active && stored) {
        setSettings((prev) => ({ ...prev, ...stored }));
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!window.api?.onStatus) return undefined;
    const unsubscribe = window.api.onStatus((payload) => {
      if (!payload) return;
      if (payload.stage) {
        setStatusStage(payload.stage);
      }
      setActiveToolName(payload.tool || '');
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!isSending) {
      setStatusStage('thinking');
      setActiveToolName('');
    }
  }, [isSending]);

  useEffect(() => {
    if (!showSettings || !window.api) return;

    const loadLocal = async () => {
      setIsLoadingLocal(true);
      setOllamaLocalError('');
      try {
        const models = await window.api.listOllamaLocal();
        setLocalOllamaModels(Array.isArray(models) ? models : []);
      } catch (error) {
        setOllamaLocalError(error?.message || 'Falha ao carregar modelos locais.');
      } finally {
        setIsLoadingLocal(false);
      }
    };

    const loadRemote = async () => {
      setIsLoadingRemote(true);
      setOllamaRemoteError('');
      try {
        const models = await window.api.listOllamaRemote();
        setRemoteOllamaModels(Array.isArray(models) ? models : []);
      } catch (error) {
        setOllamaRemoteError(error?.message || 'Falha ao carregar biblioteca de modelos.');
      } finally {
        setIsLoadingRemote(false);
      }
    };

    const loadGemini = async () => {
      setIsLoadingGeminiModels(true);
      setGeminiModelsError('');
      try {
        const models = await window.api.listGeminiModels();
        setGeminiModels(Array.isArray(models) ? models : []);
      } catch (error) {
        setGeminiModelsError(error?.message || 'Falha ao carregar modelos Gemini.');
      } finally {
        setIsLoadingGeminiModels(false);
      }
    };

    if (settingsTab === 'ollama') {
      loadLocal();
      loadRemote();
    }
    if (settingsTab === 'gemini') {
      loadGemini();
    }
  }, [showSettings, settingsTab]);

  const handleRefreshOllama = async () => {
    if (!window.api) return;
    setOllamaLocalError('');
    setOllamaRemoteError('');
    setIsLoadingLocal(true);
    setIsLoadingRemote(true);
    try {
      const [localResult, remoteResult] = await Promise.allSettled([
        window.api.listOllamaLocal(),
        window.api.listOllamaRemote()
      ]);
      if (localResult.status === 'fulfilled') {
        setLocalOllamaModels(Array.isArray(localResult.value) ? localResult.value : []);
      } else {
        setOllamaLocalError(localResult.reason?.message || 'Failed to refresh local models.');
      }
      if (remoteResult.status === 'fulfilled') {
        setRemoteOllamaModels(Array.isArray(remoteResult.value) ? remoteResult.value : []);
      } else {
        setOllamaRemoteError(remoteResult.reason?.message || 'Failed to refresh library models.');
      }
    } finally {
      setIsLoadingLocal(false);
      setIsLoadingRemote(false);
    }
  };

  const handleRefreshGemini = async () => {
    if (!window.api) return;
    setGeminiModelsError('');
    setIsLoadingGeminiModels(true);
    try {
      const models = await window.api.listGeminiModels();
      setGeminiModels(Array.isArray(models) ? models : []);
    } catch (error) {
      setGeminiModelsError(error?.message || 'Failed to refresh Gemini models.');
    } finally {
      setIsLoadingGeminiModels(false);
    }
  };

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (window.api) {
      window.api.setSettings({ [key]: value });
    }
  };

  const handleSend = async () => {
    let finalInput = input.trim();

    // Append transcription context if present
    if (transcriptionPreview) {
      finalInput = `[Transcrição do Áudio Original]:\n${transcriptionPreview}\n\n[Solicitação do Usuário]:\n${finalInput}`;
    }

    if ((!finalInput || finalInput.length === 0) && !pendingImage) return;
    if (!window.api) return;

    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;

    const userMessage = {
      role: 'user',
      content: finalInput,
      imageDataUrl: pendingImage
    };

    // Clear preview after sending
    setTranscriptionPreview(null);

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setPendingImage(null);
    setIsSending(true);

    try {
      const response = await window.api.chat(nextMessages);
      if (activeRequestId.current !== requestId) return;
      const assistantMessage = {
        role: 'assistant',
        content: response || 'No response received.'
      };
      setMessages([...nextMessages, assistantMessage]);
    } catch (error) {
      if (activeRequestId.current !== requestId) return;
      const assistantMessage = {
        role: 'assistant',
        content: `Error: ${error?.message || error}`
      };
      setMessages([...nextMessages, assistantMessage]);
    } finally {
      if (activeRequestId.current === requestId) {
        setIsSending(false);
      }
    }
  };

  const handleScreenshot = async () => {
    if (!window.api) return;
    try {
      const dataUrl = await window.api.captureScreenshot();
      if (dataUrl) {
        setPendingImage(dataUrl);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Screenshot failed: ${error?.message || error}` }
      ]);
    }
  };

  const handleNewChat = () => {
    if (window.api?.cancelChat) {
      window.api.cancelChat();
    }
    activeRequestId.current += 1;
    setMessages([]);
    setInput('');
    setPendingImage(null);
    setIsSending(false);
    setStatusStage('thinking');
    setActiveToolName('');
  };

  const handleHide = () => {
    if (window.api?.hideWindow) {
      window.api.hideWindow();
    }
  };

  const handleQuit = () => {
    if (window.api?.closeWindow) {
      window.api.closeWindow();
    }
  };

  const handleMicrophoneClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        if (window.api && window.api.sendRecordingStatus) {
          window.api.sendRecordingStatus(false);
        }
        // Interval is cleared in onstop
      }
      // Close streams and context
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(t => t.stop());
        audioStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      setAudioLevel(0);
      return;
    }

    // Start recording
    if (!window.api) return;
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume(); // Ensure context is running
      audioContextRef.current = audioContext;

      // Create Analyser (Audio Mix & Visualization)
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      // Create Destination (Recorder Input)
      const destination = audioContext.createMediaStreamDestination();

      // Chain: Sources -> Analyser -> Destination
      analyser.connect(destination);

      const sources = [];

      // 1. Microphone
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (micStream.getAudioTracks().length > 0) {
          console.log('Mic track obtained:', micStream.getAudioTracks()[0].label);
          const micSource = audioContext.createMediaStreamSource(micStream);
          micSource.connect(analyser); // Mix into analyser
          sources.push(micStream);
        }
      } catch (micErr) {
        console.error('Mic access failed:', micErr);
        throw new Error('Microfone inacessível.');
      }

      // 2. System Audio (if enabled)
      // 2. System Audio (if enabled)
      if (includeSystemAudio) {
        try {
          const sourcesList = await window.api.getScreenSources();
          const sourceId = sourcesList[0]?.id;

          if (sourceId) {
            console.log('Requesting system audio from source:', sourceId);

            const sysStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              },
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId
                }
              }
            });

            const sysAudioTrack = sysStream.getAudioTracks()[0];

            if (sysAudioTrack) {
              console.log('System audio track obtained (ChromeMediaSource):', sysAudioTrack.label);
              const sysAudioStream = new MediaStream([sysAudioTrack]);
              const sysSource = audioContext.createMediaStreamSource(sysAudioStream);
              sysSource.connect(analyser);
              sources.push(sysStream);
            } else {
              console.warn('System audio track missing despite success gUM');
            }
          } else {
            console.warn('No screen sources found.');
            setAudioError('Nenhuma tela encontrada.');
          }
        } catch (sysErr) {
          console.warn('System audio selection failed (Legacy Method):', sysErr);
          setAudioError('Falha ao capturar sistema.');
        }
      }

      if (sources.length === 0) {
        throw new Error('Nenhuma fonte de áudio disponível.');
      }

      // Store streams to stop later
      audioStreamRef.current = new MediaStream(sources.flatMap(s => s.getTracks()));

      // Visualizer Loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 64) * 100));
        setAudioLevel(normalized);

        if (normalized === 0 && isRecording) {
          // Logic to detect silence could go here
        } else {
          setAudioError(null);
        }

        requestAnimationFrame(updateLevel);
      };

      const mixedStream = destination.stream;
      const mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data); // Keep full backup (optional, or just discard)
          batchChunksRef.current.push(event.data); // Add to current batch
        }
      };

      const flushTranscription = async (isFinal = false) => {
        if (batchChunksRef.current.length === 0) return;

        const batchBlob = new Blob(batchChunksRef.current, { type: 'audio/webm' });
        // Reset batch immediately to capture next segments
        batchChunksRef.current = [];

        if (batchBlob.size < 1000) {
          if (isFinal) console.warn('Final flush: blob too small.');
          return;
        }

        console.log(`Flushing batch. Size: ${batchBlob.size} bytes. Final: ${isFinal}`);

        const arrayBuffer = await batchBlob.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        try {
          if (!isFinal) {
            setStatusStage('tool');
            setActiveToolName('processando trecho...');
          }
          setIsSending(true);

          const text = await window.api.transcribe(buffer);

          if (text && text.trim()) {
            if (text.startsWith('Error:')) throw new Error(text);

            // Check for hallucinations on partials
            if (text.length > 5) {
              setTranscriptionPreview(prev => {
                const separator = prev ? '\n' : '';
                return `${prev || ''}${separator}${text}`;
              });
            }
          }
        } catch (err) {
          console.error('Batch transcription failed:', err);
          // We could retry or just log error. 
          // For now, log and maybe notify via toast if critical.
        } finally {
          setIsSending(false);
          if (!isFinal) {
            setStatusStage('listening');
            setActiveToolName('gravando...');
          }
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop timer
        if (transcriptionIntervalRef.current) {
          clearInterval(transcriptionIntervalRef.current);
          transcriptionIntervalRef.current = null;
        }

        console.log('Recording stopped. Flushing remaining audio...');
        await flushTranscription(true);

        // Stop all tracks
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
        }

        // Final UI update
        setStatusStage('thinking');
        setInput("Resuma os pontos principais, tarefas e decisões dessa reunião.");

        // Visualizer
        setAudioLevel(0);
      };

      // Request data every 1 second to ensure valid webm chunks
      mediaRecorder.start(1000);

      // Start periodic flush (every 2 minutes)
      // 2 minutes = 120000 ms
      transcriptionIntervalRef.current = setInterval(() => {
        flushTranscription(false);
      }, 120000);

      setIsRecording(true);
      if (window.api && window.api.sendRecordingStatus) {
        window.api.sendRecordingStatus(true);
      }
      if (includeSystemAudio) {
        setAudioError(null); // Clear any previous errors
      }
      updateLevel(); // Start visualizer loop
    } catch (err) {
      console.error('Failed to start recording:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Recording error: ${err.message}` }
      ]);
    }
  };


  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };


  return (
    <div className="h-screen w-screen p-3">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-slate-950/80 via-slate-900/70 to-slate-800/50 text-slate-100 shadow-glass backdrop-blur-2xl">
        <header className="drag-region flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            <div>
              <p className="text-sm font-semibold tracking-wide">
                Ambi Chat <span className="ml-1 text-[10px] font-normal text-slate-400 opacity-60">v0.1.6</span>
              </p>
              <p className="text-[11px] uppercase text-slate-300/70">{providerLabel} agente</p>
            </div>
          </div>
          <div className="no-drag flex items-center gap-2">
            <span className="flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-200/80">
              {settings.provider === 'ollama' ? <Cpu size={12} /> : <Cloud size={12} />}
              {settings.provider}
            </span>
            <button
              className="rounded-full border border-white/10 bg-white/10 p-2 text-slate-200 transition hover:bg-white/20"
              onClick={handleNewChat}
              aria-label="Iniciar novo chat"
              title="Novo Chat"
            >
              <RefreshCcw size={16} />
            </button>
            <button
              className="rounded-full border border-white/10 bg-white/10 p-2 text-slate-200 transition hover:bg-white/20"
              onClick={handleHide}
              aria-label="Ocultar chat"
              title="Minimizar (Ctrl+Shift+Space)"
            >
              <Minus size={16} />
            </button>
            <button
              className="rounded-full border border-white/10 bg-white/10 p-2 text-slate-200 transition hover:bg-white/20"
              onClick={() => setShowSettings(true)}
              aria-label="Abrir configurações"
              title="Configurações"
            >
              <Settings size={16} />
            </button>
            <button
              className="rounded-full border border-white/10 bg-white/10 p-2 text-red-200/80 transition hover:bg-red-500/20 hover:text-red-200"
              onClick={handleQuit}
              aria-label="Fechar aplicação"
              title="Fechar Aplicação"
            >
              <Power size={16} />
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200/80">
              Faça perguntas, envie capturas de tela e escolha entre usar o Ollama local ou o Groq no menu de configurações.
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[82%] space-y-2 rounded-2xl border px-3 py-2 text-sm leading-relaxed ${message.role === 'user'
                  ? 'border-emerald-300/30 bg-emerald-400/10'
                  : 'border-white/10 bg-slate-900/60'
                  }`}
              >
                {message.imageDataUrl && (
                  <img
                    src={message.imageDataUrl}
                    alt="Screenshot"
                    className="h-32 w-full rounded-xl border border-white/10 object-cover"
                  />
                )}
                {message.role === 'assistant' ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {message.content || ''}
                  </ReactMarkdown>
                ) : (
                  <p className="whitespace-pre-wrap text-slate-100/90">
                    {message.content || (message.imageDataUrl ? ' ' : '')}
                  </p>
                )}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-300/80">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                </span>
                {thinkingLabel}
              </div>
            </div>
          )}
        </main>

        <footer className="relative shrink-0 border-t border-white/10 bg-slate-950/50 px-4 py-3">
          {transcriptionPreview && (
            <div className="absolute bottom-full left-0 right-0 mx-4 mb-2 overflow-hidden rounded-xl border border-emerald-500/30 bg-slate-900/95 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between border-b border-white/10 bg-emerald-500/10 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Transcrição Detectada
                </span>
                <button
                  onClick={() => setTranscriptionPreview(null)}
                  className="rounded hover:bg-white/10 p-1 text-slate-400 hover:text-white transition"
                  title="Descartar"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto p-3 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap font-mono">
                {transcriptionPreview}
              </div>
            </div>
          )}
          {pendingImage && (
            <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2">
              <img
                src={pendingImage}
                alt="Captura pendente"
                className="h-12 w-16 rounded-lg border border-white/10 object-cover"
              />
              <div className="text-xs text-slate-200/70">Captura anexada</div>
              <button
                className="ml-auto rounded-full border border-white/10 bg-white/10 p-1 text-slate-200 hover:bg-white/20"
                onClick={() => setPendingImage(null)}
                aria-label="Remover captura"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              className="no-drag rounded-2xl border border-white/10 bg-white/5 p-3 text-slate-200 transition hover:bg-white/20"
              onClick={handleScreenshot}
              aria-label="Capturar tela"
            >
              <Camera size={18} />
            </button>

            <button
              className={`no-drag rounded-2xl border p-3 transition ${isRecording
                ? 'border-red-500/50 bg-red-500/20 text-red-200 animate-pulse'
                : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/20'
                }`}
              onClick={handleMicrophoneClick}
              aria-label={isRecording ? "Parar gravação" : "Gravar áudio"}
              title={isRecording ? "Parar (Clique)" : "Gravar"}
            >
              <div className="relative">
                {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={18} />}
                {isRecording && (
                  <span
                    className="absolute -bottom-1 -right-1 block h-1.5 w-1.5 rounded-full bg-green-400 transition-all"
                    style={{
                      transform: `scale(${1 + (audioLevel / 50)})`,
                      opacity: Math.max(0.3, audioLevel / 100)
                    }}
                  />
                )}
              </div>
            </button>
            {isRecording && (
              <div className="mx-2 flex flex-col items-center">
                <div className="h-10 w-1 rounded bg-white/10">
                  <div
                    className="w-full rounded bg-emerald-400 transition-all duration-75 ease-out"
                    style={{
                      height: `${Math.min(100, Math.max(5, audioLevel))}%`,
                      marginTop: `${100 - Math.min(100, Math.max(5, audioLevel))}%`
                    }}
                  />
                </div>
                {audioLevel === 0 && (
                  <span className="absolute bottom-16 rounded bg-red-500/80 px-2 py-1 text-[10px] text-white backdrop-blur">
                    Sem Áudio?
                  </span>
                )}
              </div>
            )}
            <textarea
              className="no-drag h-14 flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              placeholder="Pergunte a Ambi..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="no-drag rounded-2xl border border-emerald-300/30 bg-emerald-400/15 p-3 text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSend}
              disabled={isSending}
              aria-label="Enviar mensagem"
            >
              <SendHorizontal size={18} />
            </button>
          </div>
          {settings.provider === 'groq' && !settings.groqApiKey && (
            <p className="mt-2 text-[11px] text-amber-200/80">
              Add your Groq API key in Settings to send requests.
            </p>
          )}
          {settings.provider === 'openai' && !settings.openaiApiKey && (
            <p className="mt-2 text-[11px] text-amber-200/80">
              Add your OpenAI API key in Settings to send requests.
            </p>
          )}
          {settings.provider === 'openrouter' && !settings.openrouterApiKey && (
            <p className="mt-2 text-[11px] text-amber-200/80">
              Add your OpenRouter API key in Settings to send requests.
            </p>
          )}
          {settings.provider === 'gemini' && !settings.geminiApiKey && (
            <p className="mt-2 text-[11px] text-amber-200/80">
              Add your Gemini API key in Settings to send requests.
            </p>
          )}
          {settings.provider === 'groq' && pendingImage && (
            <p className="mt-2 text-[11px] text-amber-200/80">
              If your Groq model does not support images, the request will fail. Use a vision model
              or switch to Ollama.
            </p>
          )}
        </footer>
      </div>

      {showSettings && (
        <div className="no-drag absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="w-[90%] max-w-sm rounded-2xl border border-white/15 bg-slate-900/90 p-4 text-sm text-slate-100 shadow-glass">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Configurações</h2>
              <button
                className="rounded-full border border-white/10 bg-white/10 p-1 hover:bg-white/20"
                onClick={() => setShowSettings(false)}
                aria-label="Fechar configurações"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-3 text-[11px] uppercase tracking-widest text-slate-300/80">
              {[
                { key: 'general', label: 'Geral' },
                { key: 'ollama', label: 'Ollama' },
                { key: 'groq', label: 'Groq' },
                { key: 'openai', label: 'OpenAI' },
                { key: 'openrouter', label: 'OpenRouter' },
                { key: 'gemini', label: 'Gemini' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`shrink-0 rounded-full border px-3 py-1 transition ${settingsTab === tab.key
                    ? 'border-emerald-300/40 bg-emerald-400/20 text-emerald-100'
                    : 'border-white/10 bg-white/5 text-slate-200'
                    }`}
                  onClick={() => setSettingsTab(tab.key)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="max-h-[70vh] overflow-y-auto pr-2">
              {settingsTab === 'general' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Provedor
                  </label>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    {['ollama', 'groq', 'openai', 'openrouter', 'gemini'].map((providerOption) => (
                      <button
                        key={providerOption}
                        className={`rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${settings.provider === providerOption
                          ? 'border-emerald-300/30 bg-emerald-400/15'
                          : 'border-white/10 bg-white/5'
                          }`}
                        onClick={() => updateSetting('provider', providerOption)}
                      >
                        {providerOption}
                      </button>
                    ))}
                  </div>

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Opacidade da Janela
                  </label>
                  <div className="mb-4 flex items-center gap-3">
                    <input
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-400"
                      type="range"
                      min="0.4"
                      max="1"
                      step="0.02"
                      value={opacityValue}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        updateSetting('windowOpacity', next);
                        if (window.api?.setWindowOpacity) {
                          window.api.setWindowOpacity(next);
                        }
                      }}
                    />
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-widest text-slate-200/80">
                      {opacityLabel}
                    </span>
                  </div>

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Ferramenta de Banco de Dados
                  </label>
                  <div className="mb-4 flex gap-2">
                    <button
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${settings.dbToolEnabled
                        ? 'border-emerald-300/30 bg-emerald-400/15'
                        : 'border-white/10 bg-white/5'
                        }`}
                      onClick={() => updateSetting('dbToolEnabled', true)}
                    >
                      Ativado
                    </button>
                    <button
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${!settings.dbToolEnabled
                        ? 'border-emerald-300/30 bg-emerald-400/15'
                        : 'border-white/10 bg-white/5'
                        }`}
                      onClick={() => updateSetting('dbToolEnabled', false)}
                    >
                      Desativado
                    </button>
                  </div>

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Atalho Flutuante
                  </label>
                  <div className="mb-4 flex gap-2">
                    <button
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${settings.floatingShortcutEnabled
                        ? 'border-emerald-300/30 bg-emerald-400/15'
                        : 'border-white/10 bg-white/5'
                        }`}
                      onClick={() => {
                        updateSetting('floatingShortcutEnabled', true);
                        if (window.api?.setShortcutEnabled) {
                          window.api.setShortcutEnabled(true);
                        }
                      }}
                    >
                      Enabled
                    </button>
                    <button
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs uppercase tracking-widest transition ${!settings.floatingShortcutEnabled
                        ? 'border-emerald-300/30 bg-emerald-400/15'
                        : 'border-white/10 bg-white/5'
                        }`}
                      onClick={() => {
                        updateSetting('floatingShortcutEnabled', false);
                        if (window.api?.setShortcutEnabled) {
                          window.api.setShortcutEnabled(false);
                        }
                      }}
                    >
                      Disabled
                    </button>
                  </div>

                  <label className="mb-2 mt-4 block text-xs uppercase tracking-widest text-slate-300/70">
                    Atalho Global
                  </label>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 text-center placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 cursor-pointer hover:bg-white/10 transition"
                    value={settings.globalShortcut || 'CommandOrControl+Shift+Space'}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      const keys = [];
                      if (e.ctrlKey || e.metaKey) keys.push('CommandOrControl');
                      if (e.altKey) keys.push('Alt');
                      if (e.shiftKey) keys.push('Shift');

                      let key = e.key;
                      if (key === ' ') key = 'Space';
                      if (key.length === 1) key = key.toUpperCase();

                      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

                      const shortcut = [...keys, key].join('+');
                      updateSetting('globalShortcut', shortcut);
                    }}
                    readOnly
                    placeholder="Clique e pressione as teclas desejadas (ex: Ctrl+Shift+S)"
                  />
                  <p className="mt-2 text-[10px] text-slate-400 text-center">
                    Clique e pressione a combinação de teclas desejada para alterar o atalho de alternância.
                  </p>

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Supabase API Key
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="password"
                    placeholder="sbp_..."
                    value={settings.supabaseApiKey || ''}
                    onChange={(event) => updateSetting('supabaseApiKey', event.target.value)}
                  />
                </div>
              )}

              {settingsTab === 'ollama' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Endpoint Ollama
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="text"
                    placeholder="http://localhost:11434"
                    value={settings.ollamaEndpoint || ''}
                    onChange={(event) => updateSetting('ollamaEndpoint', event.target.value)}
                  />
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Chave API Ollama (opcional)
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="password"
                    placeholder="sk-..."
                    value={settings.ollamaApiKey || ''}
                    onChange={(event) => updateSetting('ollamaApiKey', event.target.value)}
                  />

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Modelo Ollama
                  </label>
                  <div className="mb-3 flex items-center gap-2">
                    <select
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      value={ollamaSelectValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue !== '__custom__') {
                          updateSetting('ollamaModel', nextValue);
                        }
                      }}
                    >
                      {localOllamaNames.length > 0 && (
                        <optgroup label="Instalados">
                          {localOllamaNames.map((name) => (
                            <option key={`local-${name}`} value={name} className="bg-slate-900">
                              {name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {filteredRemoteOllama.length > 0 && (
                        <optgroup label="Disponível para download">
                          {filteredRemoteOllama.map((model) => (
                            <option
                              key={`remote-${model.name}`}
                              value={model.name}
                              className="bg-slate-900"
                            >
                              {model.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="__custom__" className="bg-slate-900">
                        Personalizado...
                      </option>
                    </select>
                    <button
                      className="rounded-full border border-white/10 bg-white/10 p-2 text-slate-200 transition hover:bg-white/20"
                      onClick={handleRefreshOllama}
                      type="button"
                      aria-label="Atualizar modelos Ollama"
                    >
                      {isLoadingLocal || isLoadingRemote ? '...' : <RefreshCcw size={14} />}
                    </button>
                  </div>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="text"
                    placeholder="llama3.2-vision"
                    value={settings.ollamaModel || ''}
                    onChange={(event) => updateSetting('ollamaModel', event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest text-slate-300/70">
                    {ollamaSizeLabel && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                        Tamanho: {ollamaSizeLabel}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                      {ollamaCapabilityLabel === 'image + text' ? 'imagem + texto' : 'texto'}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-300/70">
                    Instalados: {localOllamaNames.length || 0} | Biblioteca: {remoteOllamaModels.length || 0}
                  </div>
                  <input
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="text"
                    placeholder="Pesquisar biblioteca Ollama..."
                    value={ollamaSearch}
                    onChange={(event) => setOllamaSearch(event.target.value)}
                  />
                  {ollamaLocalError && (
                    <p className="mt-2 text-[11px] text-amber-200/80">{ollamaLocalError}</p>
                  )}
                  {ollamaRemoteError && (
                    <p className="mt-2 text-[11px] text-amber-200/80">{ollamaRemoteError}</p>
                  )}

                  <label className="mb-2 mt-4 block text-xs uppercase tracking-widest text-slate-300/70">
                    Opções Ollama (JSON)
                  </label>
                  <textarea
                    className="h-20 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    placeholder='{"num_ctx": 2048, "num_gpu": 40}'
                    value={settings.ollamaOptions || ''}
                    onChange={(event) => updateSetting('ollamaOptions', event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest text-slate-300/70">
                    {ollamaOptionPresets.map((preset) => (
                      <button
                        key={preset.label}
                        className={`rounded-full border px-3 py-1 transition ${activeOllamaPreset === preset.label
                          ? 'border-emerald-300/40 bg-emerald-400/20 text-emerald-100'
                          : 'border-white/10 bg-white/5 text-slate-200'
                          }`}
                        onClick={() => updateSetting('ollamaOptions', preset.value)}
                        type="button"
                      >
                        {preset.label === 'Balanced (2K ctx)' ? 'Equilibrado (2K ctx)' :
                          preset.label === 'More GPU (2K ctx)' ? 'Mais GPU (2K ctx)' :
                            preset.label === 'Low VRAM (1K ctx)' ? 'Pouca VRAM (1K ctx)' : preset.label}
                      </button>
                    ))}
                    <button
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200 transition"
                      onClick={() => updateSetting('ollamaOptions', '')}
                      type="button"
                    >
                      Limpar
                    </button>
                  </div>
                  {!isOllamaOptionsValid && (
                    <p className="mt-2 text-[11px] text-amber-200/80">
                      JSON inválido. Corrija a sintaxe para aplicar as opções do Ollama.
                    </p>
                  )}
                </div>
              )}

              {settingsTab === 'groq' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Chave API Groq
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="password"
                    placeholder="gsk_..."
                    value={settings.groqApiKey || ''}
                    onChange={(event) => updateSetting('groqApiKey', event.target.value)}
                  />

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Modelo Groq
                  </label>
                  <select
                    className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    value={groqSelectValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (nextValue !== '__custom__') {
                        updateSetting('groqModel', nextValue);
                      }
                    }}
                  >
                    {groqModelOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-slate-900">
                        {option.label}
                      </option>
                    ))}
                    <option value="__custom__" className="bg-slate-900">
                      Personalizado...
                    </option>
                  </select>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="text"
                    placeholder="meta-llama/llama-4-scout-17b-16e-instruct"
                    value={settings.groqModel || ''}
                    onChange={(event) => updateSetting('groqModel', event.target.value)}
                  />
                </div>
              )}

              {settingsTab === 'openai' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Chave API OpenAI
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="password"
                    placeholder="sk-..."
                    value={settings.openaiApiKey || ''}
                    onChange={(event) => updateSetting('openaiApiKey', event.target.value)}
                  />

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Modelo OpenAI
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    type="text"
                    placeholder="gpt-4o-mini"
                    value={settings.openaiModel || ''}
                    onChange={(event) => updateSetting('openaiModel', event.target.value)}
                  />
                </div>
              )}

              {settingsTab === 'openrouter' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Chave API OpenRouter
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-emerald-400/40"
                    type="password"
                    placeholder="sk-or-..."
                    value={settings.openrouterApiKey || ''}
                    onChange={(event) => updateSetting('openrouterApiKey', event.target.value)}
                  />

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Modelo OpenRouter
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-emerald-400/40"
                    type="text"
                    placeholder="openrouter/auto"
                    value={settings.openrouterModel || ''}
                    onChange={(event) => updateSetting('openrouterModel', event.target.value)}
                  />
                </div>
              )}

              {settingsTab === 'gemini' && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Chave API Gemini
                  </label>
                  <input
                    className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-emerald-400/40"
                    type="password"
                    placeholder="AIza..."
                    value={settings.geminiApiKey || ''}
                    onChange={(event) => updateSetting('geminiApiKey', event.target.value)}
                  />

                  <label className="mb-2 block text-xs uppercase tracking-widest text-slate-300/70">
                    Modelo Gemini
                  </label>
                  <div className="mb-3 flex items-center gap-2">
                    <select
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                      value={geminiSelectValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue !== '__custom__') {
                          updateSetting('geminiModel', nextValue);
                        }
                      }}
                    >
                      {filteredGeminiModels.map((option) => (
                        <option key={option.id} value={option.id} className="bg-slate-900">
                          {option.label}
                        </option>
                      ))}
                      <option value="__custom__" className="bg-slate-900">
                        Personalizado...
                      </option>
                    </select>
                    <button
                      className="rounded-full border border-white/10 bg-white/10 p-2 text-slate-200 transition hover:bg-white/20"
                      onClick={handleRefreshGemini}
                      type="button"
                      aria-label="Atualizar modelos Gemini"
                    >
                      {isLoadingGeminiModels ? '...' : <RefreshCcw size={14} />}
                    </button>
                  </div>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-emerald-400/40"
                    type="text"
                    placeholder="gemini-2.5-flash"
                    value={settings.geminiModel || ''}
                    onChange={(event) => updateSetting('geminiModel', event.target.value)}
                  />
                  <div className="mt-2 text-[11px] text-slate-300/70">
                    Modelos: {geminiModelOptions.length || 0}
                  </div>
                  <input
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-emerald-400/40"
                    type="text"
                    placeholder="Pesquisar modelos Gemini..."
                    value={geminiSearch}
                    onChange={(event) => setGeminiSearch(event.target.value)}
                  />
                  {geminiModelsError && (
                    <p className="mt-2 text-[11px] text-amber-200/80">{geminiModelsError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
