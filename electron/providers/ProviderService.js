const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const SUPABASE_ENDPOINT = 'https://svldwcfxhgnqqrdugwzv.supabase.co/rest/v1';

const DB_SYSTEM_PROMPT = `Voce e um assistente especializado em analisar dados da Ambiental SC.
Seu objetivo e responder a pergunta do usuario com base APENAS no JSON fornecido.
Diretrizes:
1. Fidelidade: Nao invente informacoes. Se nao estiver no JSON, diga que nao encontrou.
2. Clareza: Resuma os dados de forma organizada.
3. Se houver muitos itens, liste os mais relevantes ou agrupe por categoria/cidade.`;


const DB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscarMateriais',
      description: 'Busca materiais no banco de dados da Ambiental SC usando busca_textual.',
      parameters: {
        type: 'object',
        properties: {
          termo: {
            type: 'string',
            description: 'Termo principal do material (ex.: "air fryer", "micro-ondas").'
          },
          limit: {
            type: 'integer',
            description: 'Limite de resultados (1 a 100).',
            default: 50
          }
        },
        required: ['termo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetchServiceOrders',
      description: 'Busca ordens de serviço no sistema Sofit via GraphQL. Requer paginação manual.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Texto de busca (placa ou prefixo), ex: "VT7246".'
          },
          page: {
            type: 'integer',
            description: 'Número da página atual (inicia em 1).'
          },
          lastIntegrationDate: {
            type: 'string',
            description: 'Data de corte para a API (ISO 8601), ex: "2025-01-01T00:00:00Z".'
          }
        },
        required: ['search', 'page']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetchTemplates',
      description: 'Busca um template de atendimento no Firebase. Use quando o usuario pedir "template", "texto para", "script para", ou "o que falar".',
      parameters: {
        type: 'object',
        properties: {
          keywords: {
            type: 'string',
            description: 'Palavras-chave para buscar o template (ex: "cancelamento debito", "nota fiscal").'
          },
          variables: {
            type: 'object',
            description: 'Objeto JSON com dados extraidos da conversa para preencher o template (ex: { "nome": "Maria", "codigo": "123" }). Tente extrair o máximo de campos possivel.',
            additionalProperties: true
          }
        },
        required: ['keywords', 'variables']
      }
    }
  }
];

class ProviderService {
  constructor(store) {
    this.store = store;
  }

  async chat(messages, signal, onStatus) {
    const provider = this.store.get('provider', 'ollama');
    const dbToolEnabled = this.store.get('dbToolEnabled', false);
    if (dbToolEnabled) {
      return this.chatWithTools(messages, provider, signal, onStatus);
    }
    if (provider === 'groq') return this.chatGroq(messages, signal);
    if (provider === 'openai') return this.chatOpenAI(messages, signal);
    if (provider === 'openrouter') return this.chatOpenRouter(messages, signal);
    if (provider === 'gemini') return this.chatGemini(messages, signal);
    return this.chatOllama(messages, signal);
  }

  async chatWithTools(messages, provider, signal, onStatus) {
    const activeId = this.store.get('activePersonalityId');
    const personalities = this.store.get('personalities') || [];
    const activePersonality = personalities.find(p => p.id === activeId) || personalities[0];
    const systemPrompt = activePersonality ? activePersonality.prompt : '';

    const systemMessage = { role: 'system', content: systemPrompt };
    const conversation = [systemMessage, ...messages];
    const hasImage = messages.some((message) => Boolean(message.imageDataUrl));
    if (hasImage) {
      return this.chatVisionDbPipeline(messages, provider, signal, onStatus);
    }
    if (provider === 'gemini') {
      return this.chatTextDbPipeline(messages, provider, signal, onStatus);
    }
    if (provider === 'groq') {
      return this.chatGroqWithTools(conversation, signal, onStatus);
    }
    if (provider === 'openai') {
      return this.chatOpenAIWithTools(conversation, signal, onStatus);
    }
    if (provider === 'openrouter') {
      return this.chatOpenRouterWithTools(conversation, signal, onStatus);
    }
    return this.chatOllamaWithTools(conversation, signal, onStatus);
  }

  async chatVisionDbPipeline(messages, provider, signal, onStatus) {
    const notify = typeof onStatus === 'function' ? onStatus : () => { };
    const userMessage = [...messages].reverse().find((msg) => msg.role === 'user') || {};
    // FIX: Search in reverse to find the LATEST image, not the first one in history
    const imageMessage = [...messages].reverse().find((msg) => msg.imageDataUrl) || userMessage;
    const imageDataUrl = imageMessage?.imageDataUrl;

    const visionPrompt = {
      role: 'system',
      content:
        'Identifique o item principal da imagem. Responda apenas com um termo curto em portugues (1 a 3 palavras), sem pontuacao.'
    };

    const visionUser = {
      role: 'user',
      content: userMessage?.content || 'Qual item aparece na imagem?',
      imageDataUrl
    };

    notify({ stage: 'thinking' });
    console.log('[Vision] Identifying item...');
    console.log('[Vision] User Content:', visionUser.content);
    console.log('[Vision] Image Data Length:', visionUser.imageDataUrl ? visionUser.imageDataUrl.length : 0);
    console.log('[Vision] Image Data Preview:', visionUser.imageDataUrl ? visionUser.imageDataUrl.substring(0, 50) : 'None');

    const visionResponse = await this.requestProvider(
      provider,
      [visionPrompt, visionUser],
      null,
      signal,
      visionPrompt.content
    );

    let term = (visionResponse?.content || '').trim();
    term = term.replace(/^\"|\"$/g, '').replace(/\n/g, ' ').trim();
    if (!term) {
      term = (userMessage?.content || '').trim();
    }
    if (!term) {
      throw new Error('Nao foi possivel identificar o item na imagem.');
    }

    notify({ stage: 'tool', tool: 'buscarMateriais' });
    const toolResult = await this.buscarMateriais({ termo: term, limit: 50 });

    const finalSystemPrompt = `${DB_SYSTEM_PROMPT}\n\nOs dados ja foram fornecidos em JSON. Nao chame ferramentas.`;
    const finalMessages = [
      { role: 'system', content: finalSystemPrompt },
      {
        role: 'user',
        content: `Termo identificado: ${term}\nPergunta original: ${userMessage?.content || '-'
          }\nJSON:\n${JSON.stringify(toolResult)}`
      }
    ];

    notify({ stage: 'thinking' });
    const finalResponse = await this.requestProvider(
      provider,
      finalMessages,
      null,
      signal,
      finalSystemPrompt
    );

    return finalResponse?.content || '';
  }

  async chatTextDbPipeline(messages, provider, signal, onStatus) {
    const notify = typeof onStatus === 'function' ? onStatus : () => { };
    const userMessage = [...messages].reverse().find((msg) => msg.role === 'user') || {};
    const prompt = {
      role: 'system',
      content:
        'Identifique o item principal solicitado. Responda apenas com um termo curto em portugues (1 a 3 palavras), sem pontuacao.'
    };
    const user = {
      role: 'user',
      content: userMessage?.content || ''
    };

    notify({ stage: 'thinking' });
    const identifyResponse = await this.requestProvider(
      provider,
      [prompt, user],
      null,
      signal,
      prompt.content
    );
    let term = (identifyResponse?.content || '').trim();
    term = term.replace(/^\"|\"$/g, '').replace(/\n/g, ' ').trim();
    if (!term) {
      term = (userMessage?.content || '').trim();
    }
    if (!term) {
      throw new Error('Nao foi possivel identificar o item solicitado.');
    }

    notify({ stage: 'tool', tool: 'buscarMateriais' });
    const toolResult = await this.buscarMateriais({ termo: term, limit: 50 });

    const finalSystemPrompt = `${DB_SYSTEM_PROMPT}\n\nOs dados ja foram fornecidos em JSON. Nao chame ferramentas.`;
    const finalMessages = [
      { role: 'system', content: finalSystemPrompt },
      {
        role: 'user',
        content: `Termo identificado: ${term}\nPergunta original: ${userMessage?.content || '-'
          }\nJSON:\n${JSON.stringify(toolResult)}`
      }
    ];

    notify({ stage: 'thinking' });
    const finalResponse = await this.requestProvider(
      provider,
      finalMessages,
      null,
      signal,
      finalSystemPrompt
    );

    return finalResponse?.content || '';
  }

  async chatGroq(messages, signal) {
    const responseMessage = await this.requestGroq(messages, null, signal);
    return responseMessage?.content || '';
  }

  async chatGroqWithTools(messages, signal, onStatus) {
    return this.runToolLoop({
      provider: 'groq',
      messages,
      signal,
      onStatus
    });
  }

  async chatOpenAI(messages, signal) {
    const responseMessage = await this.requestOpenAI(messages, null, signal);
    return responseMessage?.content || '';
  }

  async chatOpenAIWithTools(messages, signal, onStatus) {
    return this.runToolLoop({
      provider: 'openai',
      messages,
      signal,
      onStatus
    });
  }

  async chatOpenRouter(messages, signal) {
    const responseMessage = await this.requestOpenRouter(messages, null, signal);
    return responseMessage?.content || '';
  }

  async chatOpenRouterWithTools(messages, signal, onStatus) {
    return this.runToolLoop({
      provider: 'openrouter',
      messages,
      signal,
      onStatus
    });
  }

  async chatGemini(messages, signal) {
    const responseMessage = await this.requestGemini(messages, { tools: null }, signal);
    return responseMessage?.content || '';
  }

  async chatOllama(messages, signal) {
    const responseMessage = await this.requestOllama(messages, null, signal);
    return responseMessage?.content || '';
  }

  async chatOllamaWithTools(messages, signal, onStatus) {
    return this.runToolLoop({
      provider: 'ollama',
      messages,
      signal,
      onStatus
    });
  }

  async runToolLoop({ provider, messages, signal, onStatus }) {
    const notify = typeof onStatus === 'function' ? onStatus : () => { };
    let conversation = [...messages];
    // Increased loop limit to 10 to allow Sofit pagination
    for (let step = 0; step < 10; step += 1) {
      notify({ stage: 'thinking' });
      const responseMessage =
        provider === 'openai'
          ? await this.requestOpenAI(conversation, DB_TOOLS, signal)
          : provider === 'openrouter'
            ? await this.requestOpenRouter(conversation, DB_TOOLS, signal)
            : provider === 'groq'
              ? await this.requestGroq(conversation, DB_TOOLS, signal)
              : await this.requestOllama(conversation, DB_TOOLS, signal);

      if (!responseMessage) {
        return '';
      }

      const toolCalls = responseMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return responseMessage.content || '';
      }

      const toolMessages = await this.handleToolCalls(toolCalls, notify);
      notify({ stage: 'thinking' });
      conversation = [
        ...conversation,
        {
          ...responseMessage,
          role: responseMessage.role || 'assistant',
          content: responseMessage.content || ''
        },
        ...toolMessages
      ];
    }
    return 'Tool loop exceeded.';
  }

  async requestGroq(messages, tools, signal) {
    const apiKey = this.store.get('groqApiKey', '');
    if (!apiKey) {
      throw new Error('Groq API key is missing. Add it in Settings.');
    }

    const hasImages = messages.some((m) => Boolean(m.imageDataUrl));
    let userModel = this.store.get('groqModel', 'meta-llama/llama-4-scout-17b-16e-instruct');

    if (hasImages) {
      userModel = this.store.get('groqVisionModel', 'llama-3.2-11b-vision-preview');
    }

    const textFallbacks = [
      'llama-3.1-8b-instant',
      'openai/gpt-oss-120b',
    ];

    const visionFallbacks = [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-prompt-guard-2-22m'
    ];

    const fallbackModels = hasImages ? visionFallbacks : textFallbacks;

    // Create unique list of models to try: user's choice first, then fallbacks
    const modelsToTry = [userModel, ...fallbackModels].filter((value, index, self) => {
      return self.indexOf(value) === index;
    });

    let lastError = null;

    for (const model of modelsToTry) {
      const formattedMessages = this.formatGroqMessages(messages);
      const body = {
        model,
        messages: formattedMessages,
        temperature: 0.2
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      try {
        const response = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          signal,
          body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data?.usage) {
          console.log('[Groq Usage]', JSON.stringify(data.usage, null, 2));
        }

        if (!response.ok) {
          let message = data?.error?.message || data?.error || 'Groq request failed.';

          if (typeof message === 'string' && (
            message.includes('over capacity') ||
            message.includes('rate limit') ||
            message.includes('too many requests')
          )) {
            console.warn(`[Groq] Model ${model} unavailable: ${message}. Trying next fallback...`);
            lastError = new Error(`Groq ${model}: ${message}`);
            continue;
          }

          if (
            hasImages &&
            typeof message === 'string' &&
            message.includes('content must be a string')
          ) {
            console.warn(`[Groq] Model ${model} does not support images. Trying next...`);
            lastError = new Error(`${message} (Model ${model} does not support images)`);
            continue;
          }

          throw new Error(message);
        }

        return data?.choices?.[0]?.message || null;

      } catch (error) {
        if (signal?.aborted) throw error;

        if (lastError && error.message === lastError.message) {
          continue;
        }

        if (
          error.message.includes('over capacity') ||
          error.message.includes('rate limit') ||
          (hasImages && error.message.includes('content must be a string'))
        ) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Groq request failed after trying available models.');
  }

  async requestOpenAI(messages, tools, signal) {
    const apiKey = this.store.get('openaiApiKey', '');
    if (!apiKey) {
      throw new Error('OpenAI API key is missing. Add it in Settings.');
    }

    const openaiModel = this.store.get('openaiModel', 'gpt-4o-mini');
    const formattedMessages = this.formatOpenAIMessages(messages);

    const body = {
      model: openaiModel,
      messages: formattedMessages,
      temperature: 0.2
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.error || 'OpenAI request failed.';
      throw new Error(message);
    }

    return data?.choices?.[0]?.message || null;
  }

  async requestOpenRouter(messages, tools, signal) {
    const apiKey = this.store.get('openrouterApiKey', '');
    if (!apiKey) {
      throw new Error('OpenRouter API key is missing. Add it in Settings.');
    }

    const openrouterModel = this.store.get('openrouterModel', 'openrouter/auto');
    const formattedMessages = this.formatOpenAIMessages(messages);

    const body = {
      model: openrouterModel,
      messages: formattedMessages,
      temperature: 0.2
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://ambi-chat.local',
        'X-Title': 'Ambi Chat'
      },
      signal,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.error || 'OpenRouter request failed.';
      throw new Error(message);
    }

    return data?.choices?.[0]?.message || null;
  }

  async requestGemini(messages, { systemInstruction, tools }, signal) {
    const apiKey = this.store.get('geminiApiKey', '');
    if (!apiKey) {
      throw new Error('Gemini API key is missing. Add it in Settings.');
    }

    const geminiModel = this.normalizeGeminiModel(
      this.store.get('geminiModel', 'gemini-2.5-flash')
    );
    const allowSystemInstruction = this.supportsGeminiSystemInstruction(geminiModel);
    const { contents, effectiveSystemInstruction } = this.buildGeminiContents(
      messages,
      systemInstruction,
      allowSystemInstruction
    );

    const body = {
      contents
    };
    if (effectiveSystemInstruction) {
      body.system_instruction = {
        parts: [{ text: effectiveSystemInstruction }]
      };
    }
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(`${GEMINI_ENDPOINT}/${geminiModel}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      signal,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.error || 'Gemini request failed.';
      throw new Error(message);
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((part) => part?.text)
      .filter(Boolean)
      .join('');
    return { content: text };
  }

  async requestOllama(messages, tools, signal) {
    const endpoint = this.normalizeOllamaEndpoint(
      this.store.get('ollamaEndpoint', 'http://localhost:11434')
    );
    const ollamaModel = this.store.get('ollamaModel', 'llama3.2-vision');
    const optionsRaw = this.store.get('ollamaOptions', '');
    let options = null;
    if (optionsRaw && typeof optionsRaw === 'string' && optionsRaw.trim().length > 0) {
      try {
        options = JSON.parse(optionsRaw);
      } catch (error) {
        throw new Error('Invalid Ollama options JSON. Fix it in Settings.');
      }
    }

    const formattedMessages = this.formatOllamaMessages(messages);
    const body = {
      model: ollamaModel,
      messages: formattedMessages,
      stream: false,
      ...(options ? { options } : {})
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error || 'Ollama request failed.';
      throw new Error(message);
    }

    return data?.message || null;
  }

  async requestProvider(provider, messages, tools, signal, systemInstruction) {
    if (provider === 'openai') {
      return this.requestOpenAI(messages, tools, signal);
    }
    if (provider === 'openrouter') {
      return this.requestOpenRouter(messages, tools, signal);
    }
    if (provider === 'groq') {
      return this.requestGroq(messages, tools, signal);
    }
    if (provider === 'gemini') {
      return this.requestGemini(messages, { systemInstruction, tools }, signal);
    }
    return this.requestOllama(messages, tools, signal);
  }

  formatGroqMessages(messages) {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.tool_call_id,
          name: message.name,
          content: message.content || ''
        };
      }

      if (message.tool_calls) {
        return {
          role: message.role,
          content: message.content || '',
          tool_calls: message.tool_calls
        };
      }

      if (!message.imageDataUrl) {
        return { role: message.role, content: message.content || '' };
      }

      const content = [];
      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }
      content.push({ type: 'image_url', image_url: { url: message.imageDataUrl } });

      return { role: message.role, content };
    });
  }

  formatOpenAIMessages(messages) {
    return this.formatGroqMessages(messages);
  }

  formatGeminiContents(messages) {
    return messages
      .filter((message) => message.role !== 'system' && message.role !== 'tool')
      .map((message) => {
        const role = message.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (message.content) {
          parts.push({ text: message.content });
        }
        if (message.imageDataUrl) {
          const { mimeType, data } = this.parseDataUrl(message.imageDataUrl);
          if (data) {
            parts.push({
              inline_data: {
                mime_type: mimeType,
                data
              }
            });
          }
        }
        return { role, parts };
      });
  }

  formatOllamaMessages(messages) {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.tool_call_id,
          name: message.name,
          content: message.content || ''
        };
      }

      const entry = {
        role: message.role,
        content: message.content || ''
      };

      if (message.tool_calls) {
        entry.tool_calls = message.tool_calls;
      }

      if (message.imageDataUrl) {
        entry.images = [this.stripDataUrl(message.imageDataUrl)];
      }

      return entry;
    });
  }

  async handleToolCalls(toolCalls, onStatus) {
    const notify = typeof onStatus === 'function' ? onStatus : () => { };
    const results = [];
    for (const call of toolCalls) {
      const name = call?.function?.name || call?.name;
      const rawArgs = call?.function?.arguments || call?.arguments || '{}';
      let args = {};
      try {
        args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs || {};
      } catch (error) {
        args = {};
      }

      if (name === 'buscarMateriais') {
        notify({ stage: 'tool', tool: name });
        const result = await this.buscarMateriais(args);
        results.push({
          role: 'tool',
          tool_call_id: call?.id || call?.tool_call_id,
          name,
          content: JSON.stringify(result)
        });
      } else if (name === 'fetchServiceOrders') {
        notify({ stage: 'tool', tool: name });
        try {
          const result = await this.fetchServiceOrders(args);
          results.push({
            role: 'tool',
            tool_call_id: call?.id || call?.tool_call_id,
            name,
            content: JSON.stringify(result)
          });
        } catch (err) {
          results.push({
            role: 'tool',
            tool_call_id: call?.id || call?.tool_call_id,
            name,
            content: JSON.stringify({ error: err.message })
          });
        }
      } else if (name === 'fetchTemplates') {
        notify({ stage: 'tool', tool: name });
        try {
          const result = await this.fetchTemplates(args);
          results.push({
            role: 'tool',
            tool_call_id: call?.id || call?.tool_call_id,
            name,
            content: JSON.stringify(result)
          });
        } catch (err) {
          results.push({
            role: 'tool',
            tool_call_id: call?.id || call?.tool_call_id,
            name,
            content: JSON.stringify({ error: err.message })
          });
        }
      } else {
        results.push({
          role: 'tool',
          tool_call_id: call?.id || call?.tool_call_id,
          name: name || 'unknown',
          content: JSON.stringify({ error: 'Tool not implemented.' })
        });
      }
    }
    return results;
  }

  normalizeTerm(term) {
    return String(term || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  pickRootTerm(term) {
    const normalized = this.normalizeTerm(term);
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const candidates = tokens.filter((token) => token.length >= 3);
    if (candidates.length > 0) {
      return candidates.sort((a, b) => a.length - b.length)[0];
    }
    return tokens[0] || normalized;
  }

  async buscarMateriais(args) {
    const apiKey = this.store.get('supabaseApiKey', '');
    if (!apiKey) {
      throw new Error('Supabase API key is missing. Add it in Settings.');
    }

    const rawTerm = args?.termo || args?.query || args?.busca_textual || '';
    const normalizedRoot = this.pickRootTerm(rawTerm);
    if (!normalizedRoot) {
      throw new Error('Tool argument "termo" is required.');
    }

    const limit = Math.min(Math.max(Number(args?.limit || 50), 1), 100);
    const url = new URL(`${SUPABASE_ENDPOINT}/coletaveis`);
    url.searchParams.set('busca_textual', `ilike.*${normalizedRoot}*`);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error || 'Supabase request failed.';
      throw new Error(message);
    }

    return {
      query: `ilike.*${normalizedRoot}*`,
      count: Array.isArray(data) ? data.length : 0,
      items: Array.isArray(data) ? data : []
    };
  }

  async getSofitToken() {
    // Try auto-login
    const email = this.store.get('sofitEmail', '');
    const password = this.store.get('sofitPassword', '');

    if (!email || !password) {
      throw new Error('Sofit Authentication failed: Missing Email/Password in settings.');
    }

    const baseUrl = 'https://sofitview.com.br';

    // 1. Try REST Endpoints (Primary Method)
    const restPaths = [
      '/api/v2/auth/login',
      '/api/v2/login',
      '/api/v1/users/login',
      '/api/auth/login',
      '/login'
    ];

    const payloads = [
      { email, password },
      { username: email, password },
      { user: email, password },
      { user_name: email, password }
    ];

    // Helper to recursively find token
    const findToken = (obj) => {
      if (!obj) return null;
      if (typeof obj === 'string' && obj.length > 50) return obj; // Simple heuristic
      if (typeof obj === 'object') {
        for (const key in obj) {
          const k = key.toLowerCase();
          if ((k === 'token' || k.includes('access_token') || k === 'jwt') && typeof obj[key] === 'string') {
            return obj[key];
          }
          const found = findToken(obj[key]);
          if (found) return found;
        }
      }
      return null;
    };

    for (const path of restPaths) {
      if (path === '/login') continue; // Skip root login to avoid HTML responses usually
      const url = `${baseUrl}${path}`;
      for (const payload of payloads) {
        try {
          // console.log(`Sofit Auth: Trying POST ${url} with payload keys: ${Object.keys(payload)}`);
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const json = await response.json().catch(() => null);
            const token = findToken(json);
            if (token) return token;
          }
        } catch (err) {
          // Ignore network errors during trial
        }
      }
    }

    // 2. Try GraphQL Mutations (Fallback)
    const gqlUrl = `${baseUrl}/api/v2/graphql`;
    const mutations = [
      {
        name: 'login',
        query: 'mutation($email:String!,$password:String!){ login(email:$email,password:$password){ token access_token jwt } }'
      },
      {
        name: 'authenticate',
        query: 'mutation($email:String!,$password:String!){ authenticate(email:$email,password:$password){ token access_token jwt } }'
      },
      {
        name: 'signIn',
        query: 'mutation($email:String!,$password:String!){ signIn(email:$email,password:$password){ token access_token jwt } }'
      }
    ];

    let lastError = null;

    for (const { name, query } of mutations) {
      try {
        const response = await fetch(gqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            variables: { email, password }
          })
        });

        const json = await response.json();
        const data = json?.data?.[name];

        if (data) {
          const token = findToken(data);
          if (token) return token;
        }

        if (json.errors) {
          console.warn(`Sofit Auth attempt (${name}) failed with API errors:`, json.errors);
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error('Sofit Authentication failed. Checked all REST endpoints and GraphQL mutations.');
  }

  async fetchServiceOrders({ search, page, lastIntegrationDate }) {
    if (!search) throw new Error('Search term (plate/prefix) is required.');
    const pageNum = Number(page) || 1;
    const dateFilter = lastIntegrationDate || '2025-01-01T00:00:00Z';

    const token = await this.getSofitToken();

    const query = `
      query ($search: String!, $page: Int!, $lastIntegrationDate: DateTime) {
        serviceOrders(
          search: $search,
          page: $page,
          perPage: 20,
          lastIntegrationDate: $lastIntegrationDate,
          sortField: "created_at",
          sortOrder: "DESC"
        ) {
          nodes {
            id
            name
            status
            total_cost
            created_at
            updated_at
            problem_description
            vehicle { name }
            hourmeter
            final_odometer
            supplier { name }
            employee { id name }
            foreseen_service_order_items {
              id
              name
              foreseen_quantity
              item { id name }
            }
          }
        }
      }
    `;

    const response = await fetch('https://sofitview.com.br/api/v2/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        query,
        variables: {
          search,
          page: pageNum,
          lastIntegrationDate: dateFilter
        }
      })
    });

    const json = await response.json();

    if (json.errors) {
      throw new Error(`Sofit API Error: ${JSON.stringify(json.errors)}`);
    }

    return json?.data?.serviceOrders || {};
  }

  async transcribe(audioBuffer, signal) {
    // Prioritize Groq for transcription if available (faster/cheaper)
    const groqKey = this.store.get('groqApiKey');
    const openaiKey = this.store.get('openaiApiKey');

    let provider = 'groq';
    if (!groqKey && openaiKey) {
      provider = 'openai';
    }

    return this.requestTranscribe(provider, audioBuffer, signal);
  }

  async requestTranscribe(provider, audioBuffer, signal) {
    let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
    let model = 'whisper-large-v3-turbo';
    let apiKey = this.store.get('groqApiKey');

    if (provider === 'openai') {
      endpoint = 'https://api.openai.com/v1/audio/transcriptions';
      model = 'whisper-1';
      apiKey = this.store.get('openaiApiKey');
    }

    if (!apiKey) {
      throw new Error(`API Key for ${provider} is missing. Cannot transcribe.`);
    }

    // In Node 20/Electron, FormData is globally available.
    // We need to create a Blob from the buffer to make FormData happy with filename.
    const blob = new Blob([audioBuffer], { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('model', model);
    // Force language to Portuguese to avoid "Thank you" hallucinations on silence
    formData.append('language', 'pt');
    // Prompt guides the model style and context to avoid hallucinations
    formData.append('prompt', 'Transcreva o áudio desta reunião ou conversa com clareza. Ignore silêncio e ruídos de fundo.');
    formData.append('temperature', '0.2');
    formData.append('response_format', 'json');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData,
      signal
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.error || 'Transcription failed.';
      throw new Error(message);
    }

    const rawText = data?.text || '';
    return this.cleanupTranscription(rawText);
  }

  cleanupTranscription(text) {
    if (!text) return '';

    let clean = text;

    // 1. Remove common Whisper hallucinations (subtitle credits) via Regex
    // Matches "Legenda...", "Legendas...", "Subtitle...", "Translated by..." case insensitive
    // It removes the entire matched phrase/sentence if it looks like a credit
    const creditPatterns = [
      /Legenda(s)?\s+(por|de|pelo|pela)?\s*[:\.]?\s*[A-Z][a-z]+/gi, // Legenda por [Nome]
      /Legenda\s+Adriana\s+Zanotto/gi, // Specific common one
      /Sous-titres\s+par/gi,
      /Amara\.org/gi,
      /Obrigado\./gi, // Common hallucination on silence
      /Thank\s+you[\.,!]?/gi,
      /Bye[\.,!]?/gi,
      /Ignore\s+silêncio\s+e\s+ruídos\s+de\s+fundo[\.,!]?/gi,
      /Transcreva\s+o\s+áudio[\.,!]?/gi
    ];

    for (const pattern of creditPatterns) {
      clean = clean.replace(pattern, '');
    }

    // 2. Remove repetitive loops (e.g. "Text Text Text")
    const repeatRegex = /(.{10,})\1+/g;
    clean = clean.replace(repeatRegex, '$1');

    return clean.trim();
  }


  async fetchTemplates({ keywords, variables }) {
    const token = this.store.get('firebaseToken', '');
    if (!token) {
      throw new Error('Token do Firebase não configurado nas Configurações.');
    }

    const endpoint = 'https://firestore.googleapis.com/v1/projects/atendimento-f2f9f/databases/(default)/documents/templates';

    // 1. Fetch templates from Firestore
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Erro ao buscar templates: ${err?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const documents = data.documents || [];

    // 2. Fuzzy/Simple Keyword matching
    // Filter documents where title or template content matches keywords
    const searchTerms = keywords.toLowerCase().split(' ').filter(t => t.length > 2);

    // Calculate simple score
    const scored = documents.map(doc => {
      const fields = doc.fields || {};
      const title = fields.title?.stringValue || '';
      const template = fields.template?.stringValue || '';
      const active = fields.active?.booleanValue ?? true;

      // Skip inactive if you wish, though user might want to see them. Let's filter active only by default?
      // Based on file, there is an "active" boolean value.
      if (active === false) return null;

      let score = 0;
      const combined = (title + ' ' + template).toLowerCase();

      searchTerms.forEach(term => {
        if (combined.includes(term)) score += 1;
        if (title.toLowerCase().includes(term)) score += 2; // Title match worth more
      });

      return { doc, score, title, template, fields };
    }).filter(item => item !== null && item.score > 0);

    // Sort by score desc
    scored.sort((a, b) => b.score - a.score);

    const bestMatch = scored[0];
    if (!bestMatch) {
      return { warning: 'Nenhum template encontrado com essas palavras-chave.' };
    }

    // 3. Process Logic & Fill Template
    // logic map: fields.template_logic.mapValue.fields.[variable].mapValue.fields
    //   -> condition: mapValue.fields { field: stringValue, value: stringValue }
    //   -> text: stringValue (Text to append/use if condition matches)

    let finalText = bestMatch.template;
    const logicMap = bestMatch.fields.template_logic?.mapValue?.fields || {};
    const filledVars = { ...variables };

    // Apply Logic (simple implementation based on observed structure)
    // Structure seems to be: conditional text injection based on other fields
    // Example: "contato2": { condition: { field: "contato", value: "DIGITAL" }, text: "ENTROU EM CONTATO" }
    // This implies: if variables.contato == "DIGITAL", then variables.contato2 = "ENTROU EM CONTATO"

    for (const [key, logicNode] of Object.entries(logicMap)) {
      const nodeFields = logicNode?.mapValue?.fields;
      if (!nodeFields) continue;

      const condition = nodeFields.condition?.mapValue?.fields;
      const textToApply = nodeFields.text?.stringValue;

      if (condition && textToApply) {
        const targetField = condition.field?.stringValue;
        const targetValue = condition.value?.stringValue;

        // Check if our variables meet the condition
        if (variables[targetField] === targetValue) {
          filledVars[key] = textToApply;
        } else {
          // Logic not met, maybe set empty? Or keep original if exists?
          // Usually in these engines if condition fails, and it's a derived field, it might be empty.
          if (!filledVars[key]) filledVars[key] = '';
        }
      }
    }

    // Determine user gender (example based on doc: SR/SRA options)
    // If the template has {{SR}}, we might want to infer from context or variables
    // For now, relies on LLM passing "SR": "O SR." or "A SRA."

    // Replace Mustache/Handlebars variables {{key}}
    // We simple replace globally 
    for (const [key, val] of Object.entries(filledVars)) {
      const regex = new RegExp(`{{${key}}}`, 'gi'); // Case insensitive replacement
      finalText = finalText.replace(regex, String(val));
    }

    // Cleanup unused tags? Optional. Sometimes templates leave {{missing}} visible to prompt user.
    // Let's keep them so the user knows what's missing, OR we can tell the LLM.

    return {
      template_title: bestMatch.title,
      original_template: bestMatch.template,
      filled_text: finalText,
      used_variables: filledVars,
      match_score: bestMatch.score
    };
  }

  normalizeOllamaEndpoint(raw) {
    if (!raw) return 'http://localhost:11434/api/chat';
    if (raw.includes('/api/chat')) return raw;
    return `${raw.replace(/\/$/, '')} /api/chat`;
  }

  normalizeGeminiModel(raw) {
    const value = String(raw || '').trim();
    if (!value) return 'gemini-2.5-flash';
    const withoutPrefix = value.replace(/^models\//i, '').trim();
    return withoutPrefix.toLowerCase();
  }

  supportsGeminiSystemInstruction(modelId) {
    const normalized = this.normalizeGeminiModel(modelId);
    if (!normalized) return true;
    if (normalized.startsWith('gemma')) return false;
    return true;
  }

  buildGeminiContents(messages, systemInstruction, allowSystemInstruction) {
    let effectiveSystemInstruction = systemInstruction || '';
    let contentMessages = messages;
    if (systemInstruction && !allowSystemInstruction) {
      effectiveSystemInstruction = '';
      const injected = {
        role: 'user',
        content: `INSTRUCOES DO SISTEMA: \n${systemInstruction} `
      };
      contentMessages = [injected, ...messages];
    }
    return {
      contents: this.formatGeminiContents(contentMessages),
      effectiveSystemInstruction: effectiveSystemInstruction || ''
    };
  }

  stripDataUrl(dataUrl) {
    if (!dataUrl) return '';
    const match = dataUrl.match(/^data:image\/[a-zA-Z]+;base64,(.*)$/);
    return match ? match[1] : dataUrl;
  }

  parseDataUrl(dataUrl) {
    if (!dataUrl) return { mimeType: 'image/png', data: '' };
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (!match) {
      return { mimeType: 'image/png', data: dataUrl };
    }
    return { mimeType: match[1], data: match[2] };
  }
}

module.exports = ProviderService;
