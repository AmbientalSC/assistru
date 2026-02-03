const crypto = require('crypto');

const SUPABASE_ENDPOINT = 'https://svldwcfxhgnqqrdugwzv.supabase.co/rest/v1';
const INLOG_AUTH_URL = 'https://ambientalsc.inlog.com.br/autenticacao-services/connect/token';
const INLOG_BASE_URL = 'https://ambientalsc.inlog.com.br/IntegrationColeta/api';
const INLOG_CREDENTIALS = {
    client_id: 'AmbientalSC.Client.Coleta',
    client_secret: 'QW1iaWVudGFsU0MuQ2xpZW50LkNvbGV0YQ==',
    scope: 'Inlog.Integration.Coleta.Api'
};

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
    },
    {
        type: 'function',
        function: {
            name: 'buscarColeta',
            description: 'Busca os dias e horarios de coleta de lixo (domiciliar e seletiva) para um endereco. OBTENHA o endereco completo do usuario.',
            parameters: {
                type: 'object',
                properties: {
                    endereco: {
                        type: 'string',
                        description: 'Endereço completo para busca (Rua, Número, Cidade, Estado). Ex: "Rua XV de Novembro, 123, Joinville, SC".'
                    }
                },
                required: ['endereco']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'buscarInlog',
            description: 'Consulta Falhas ou Alarmes da frota via Inlog (últimas 24h).',
            parameters: {
                type: 'object',
                properties: {
                    tipo: {
                        type: 'string',
                        enum: ['alarmes', 'falhas'],
                        description: 'Tipo de consulta: "alarmes" ou "falhas".'
                    },
                    placa: {
                        type: 'string',
                        description: 'Placa do veículo para filtrar (opcional). Ex: "QJ06F80".'
                    }
                },
                required: ['tipo']
            }
        }
    }
];

class ToolService {
    constructor(store) {
        this.store = store;
    }

    getTools() {
        return DB_TOOLS;
    }

    async executeTool(name, args) {
        if (name === 'buscarMateriais') {
            return this.buscarMateriais(args);
        }
        if (name === 'fetchServiceOrders') {
            return this.fetchServiceOrders(args);
        }
        if (name === 'fetchTemplates') {
            return this.fetchTemplates(args);
        }
        if (name === 'buscarColeta') {
            return this.buscarColeta(args);
        }
        if (name === 'buscarInlog') {
            return this.buscarInlog(args);
        }
        throw new Error(`Ferramenta desconhecida: ${name}`);
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

    async fetchTemplates({ keywords, variables }) {
        console.log('[fetchTemplates] Started with:', { keywords, variables });
        const token = this.store.get('firebaseToken', '');
        if (!token) {
            console.error('[fetchTemplates] Missing Firebase Token');
            throw new Error('Token do Firebase não configurado nas Configurações.');
        }

        const endpoint = 'https://firestore.googleapis.com/v1/projects/atendimento-f2f9f/databases/(default)/documents/templates';

        let fetchUrl = endpoint;
        const headers = {};
        let finalToken = token.trim();

        // 0. Check if token is Service Account JSON
        if (finalToken.startsWith('{') && finalToken.includes('client_email')) {
            console.log('[fetchTemplates] Detected Service Account JSON. Exchanging for Access Token...');
            try {
                finalToken = await this.getAccessTokenFromServiceAccount(finalToken);
                console.log('[fetchTemplates] Access Token generated successfully.');
            } catch (e) {
                console.error('[fetchTemplates] Service Account Auth failed:', e);
                throw new Error(`Erro na autenticação via Service Account: ${e.message}`);
            }
        }

        // Check if it's an API Key (starts with AIza) or a Bearer Token (default)
        if (finalToken.startsWith('AIza')) {
            fetchUrl = `${endpoint}?key=${finalToken}`;
        } else {
            headers['Authorization'] = `Bearer ${finalToken}`;
        }

        // 1. Fetch templates from Firestore
        console.log('[fetchTemplates] Fetching from endpoint:', fetchUrl);
        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            const err = await response.json();
            console.error('[fetchTemplates] API Error:', err);

            let msg = err?.error?.message || response.statusText;
            if (response.status === 401 && token.startsWith('ya29')) {
                msg += ' (Seu token OAuth provavelmete expirou. Gere um novo ou use uma API Key).';
            }

            throw new Error(`Erro ao buscar templates: ${msg}`);
        }

        const data = await response.json();
        const documents = data.documents || [];
        console.log(`[fetchTemplates] Fetched ${documents.length} documents.`);

        // 2. Fuzzy/Simple Keyword matching
        const searchTerms = keywords.toLowerCase().split(' ').filter(t => t.length > 2);

        const scored = documents.map(doc => {
            const fields = doc.fields || {};
            const title = fields.title?.stringValue || '';
            const template = fields.template?.stringValue || '';
            const active = fields.active?.booleanValue ?? true;

            if (active === false) return null;

            let score = 0;
            const combined = (title + ' ' + template).toLowerCase();

            searchTerms.forEach(term => {
                if (combined.includes(term)) score += 1;
                if (title.toLowerCase().includes(term)) score += 2;
            });

            return { doc, score, title, template, fields };
        }).filter(item => item !== null && item.score > 0);

        scored.sort((a, b) => b.score - a.score);

        const bestMatch = scored[0];
        if (!bestMatch) {
            return { warning: 'Nenhum template encontrado com essas palavras-chave.' };
        }

        // 3. Process Logic & Fill Template
        let finalText = bestMatch.template;
        const logicMap = bestMatch.fields.template_logic?.mapValue?.fields || {};
        const filledVars = { ...variables };

        for (const [key, logicNode] of Object.entries(logicMap)) {
            const nodeFields = logicNode?.mapValue?.fields;
            if (!nodeFields) continue;

            const condition = nodeFields.condition?.mapValue?.fields;
            const textToApply = nodeFields.text?.stringValue;

            if (condition && textToApply) {
                const targetField = condition.field?.stringValue;
                const targetValue = condition.value?.stringValue;

                if (variables[targetField] === targetValue) {
                    filledVars[key] = textToApply;
                } else {
                    if (!filledVars[key]) filledVars[key] = '';
                }
            }
        }

        for (const [key, val] of Object.entries(filledVars)) {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            finalText = finalText.replace(regex, String(val));
        }

        return {
            template_title: bestMatch.title,
            original_template: bestMatch.template,
            filled_text: finalText,
            used_variables: filledVars,
            match_score: bestMatch.score
        };
    }

    // --- Service Account Helpers ---

    base64Url(data) {
        return Buffer.from(data).toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    }

    createJWT(clientEmail, privateKey) {
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        const now = Math.floor(Date.now() / 1000);
        const claim = {
            iss: clientEmail,
            scope: 'https://www.googleapis.com/auth/datastore',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        const encodedHeader = this.base64Url(JSON.stringify(header));
        const encodedClaim = this.base64Url(JSON.stringify(claim));

        const sign = crypto.createSign('RSA-SHA256');
        sign.update(`${encodedHeader}.${encodedClaim}`);
        const signature = sign.sign(privateKey, 'base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');

        return `${encodedHeader}.${encodedClaim}.${signature}`;
    }

    async getAccessTokenFromServiceAccount(serviceAccountJson) {
        try {
            let credentials;
            try {
                credentials = JSON.parse(serviceAccountJson);
            } catch (jsonErr) {
                // Try to catch common "JS Object" paste errors
                console.error('[Auth] Validation Error. Token content (first 50 chars):', serviceAccountJson.substring(0, 50));
                throw new Error('O Token fornecido não é um JSON válido. Verifique se há aspas nas chaves (ex: "client_email") e se não há caracteres extras.');
            }

            const { client_email, private_key } = credentials;

            if (!client_email || !private_key) {
                throw new Error('JSON de Service Account inválido. Faltando client_email ou private_key.');
            }

            console.log('[Auth] Generating JWT for:', client_email);
            const jwt = this.createJWT(client_email, private_key);

            const params = new URLSearchParams();
            params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
            params.append('assertion', jwt);

            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                body: params
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('[Auth] Token exchange failed:', error);
                throw new Error(`Falha ao trocar JWT por Token: ${error.error_description || response.statusText}`);
            }

            const data = await response.json();
            return data.access_token;
        } catch (err) {
            console.error('[Auth] Service Account Error:', err);
            throw err;
        }
    }
    async buscarColeta(args) {
        const endereco = args?.endereco;
        if (!endereco) {
            throw new Error('O argumento "endereco" é obrigatório.');
        }

        console.log('[ToolService] Buscando coleta para:', endereco);

        // 1. Google Geocoding
        const googleApiKey = this.store.get('googleMapsApiKey');
        if (!googleApiKey) {
            throw new Error('Google Maps API Key não configurada. Configure em Settings > Integração.');
        }

        const googleUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        googleUrl.searchParams.set('address', endereco);
        googleUrl.searchParams.set('key', googleApiKey);
        googleUrl.searchParams.set('language', 'pt-BR');

        const googleResp = await fetch(googleUrl.toString());
        if (!googleResp.ok) {
            throw new Error(`Erro na API Google Maps: ${googleResp.statusText}`);
        }

        const googleData = await googleResp.json();
        if (googleData.status !== 'OK') {
            if (googleData.status === 'ZERO_RESULTS') {
                return {
                    found: false,
                    message: 'Endereço não encontrado. Tente ser mais específico (Rua, Número, Cidade).'
                };
            }
            throw new Error(`Erro Google Maps Geocoding: ${googleData.status} - ${googleData.error_message || ''}`);
        }

        const result = googleData.results[0];
        const lat = result.geometry.location.lat;
        const lon = result.geometry.location.lng; // Google returns 'lng', we map to 'lon'
        const display_name = result.formatted_address; // Map to variable expected below

        console.log('[ToolService] Coordenadas encontradas (Google):', lat, lon);

        // 2. AWS Coleta API
        const coletaUrl = new URL('https://ahyisv2ac8.execute-api.us-east-1.amazonaws.com/coleta');
        coletaUrl.searchParams.set('lat', lat);
        coletaUrl.searchParams.set('lng', lon);
        coletaUrl.searchParams.set('dst', '100'); // Distance buffer?

        const coletaResp = await fetch(coletaUrl.toString());
        if (!coletaResp.ok) {
            throw new Error(`Erro na API de Coleta: ${coletaResp.statusText}`);
        }

        const coletaData = await coletaResp.json();

        // Aggregating messages
        const messagesSet = new Set();

        // Return simplified data to help the AI focus
        const simplifiedResult = Array.isArray(coletaData?.result)
            ? coletaData.result.map(item => {
                const details = item[item.tipo] || {};

                if (details.mensagem) {
                    messagesSet.add(details.mensagem);
                }

                return {
                    tipo: item.tipo,
                    turno: details.turno,
                    frequencia: details.frequencia,
                    horario: details.horario
                };
            })
            : [];

        return {
            found: true,
            address_searched: endereco,
            resolved_address: display_name,
            coordinates: { lat, lon },
            coleta_info: simplifiedResult,
            orientacoes_gerais: Array.from(messagesSet) // New field for footer text
        };
    }
    async getInlogToken() {
        console.log('[Inlog] Getting Auth Token...');
        const clientId = this.store.get('inlogClientId', INLOG_CREDENTIALS.client_id);
        const clientSecret = this.store.get('inlogClientSecret', INLOG_CREDENTIALS.client_secret);

        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('scope', INLOG_CREDENTIALS.scope);

        const response = await fetch(INLOG_AUTH_URL, {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Erro Auth Inlog: ${response.status} - ${err}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    async buscarInlog(args) {
        const { tipo, placa } = args;
        if (!['alarmes', 'falhas'].includes(tipo)) {
            throw new Error('Tipo inválido. Use "alarmes" ou "falhas".');
        }

        const token = await this.getInlogToken();

        // Dates: Start = Now - 24h, End = Now - 10min (buffer)
        const now = new Date();
        const end = new Date(now.getTime() - 10 * 60000); // -10 min
        const start = new Date(now.getTime() - 24 * 60 * 60000); // -24h

        // Format to yyyy-MM-ddTHH:mm:ss for Inlog (local time assumption or UTC?)
        // The doc says "data always 24h less than current".
        // Pseudocode in doc uses ISO format.
        // JS toISOString() uses UTC. "2024-01-30T00:00:00"
        // Let's use simple string concat to ensure format.
        const toISO = (d) => d.toISOString().split('.')[0];

        const dataInicio = toISO(start);
        const dataFim = toISO(end);

        const endpoint = tipo === 'alarmes' ? 'Alarmes' : 'Falha';
        const url = new URL(`${INLOG_BASE_URL}/${endpoint}`);
        url.searchParams.set('dataInicio', dataInicio);
        url.searchParams.set('dataFim', dataFim);

        console.log(`[Inlog] Fetching ${tipo} from ${dataInicio} to ${dataFim}...`);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            throw new Error(`Erro API Inlog: ${response.statusText}`);
        }

        const jsonResponse = await response.json();

        // Inlog API returns { success: true, data: [...] }
        const list = Array.isArray(jsonResponse.data) ? jsonResponse.data : [];
        let filtered = list;

        if (placa) {
            // Normalize search input: Remove special chars (keep only alphanumeric)
            const search = placa.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            console.log(`[Inlog] Filtering for identifier/plate: ${search}`);

            filtered = list.filter(item => {
                // Normalize "placa" (e.g., RXP-2E64 -> RXP2E64)
                const p = (item.placa || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                // Normalize "identificador" (e.g., VT-7292 -> VT7292)
                const id = (item.identificador || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

                return p === search || id === search;
            });
        }

        return {
            tipo,
            periodo: { inicio: dataInicio, fim: dataFim },
            total_encontrado: list.length,
            total_retornado: filtered.length,
            resultados: filtered.slice(0, 50) // Limit to 50 items
        };
    }
}

module.exports = ToolService;
