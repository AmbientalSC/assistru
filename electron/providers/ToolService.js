const crypto = require('crypto');

const SUPABASE_ENDPOINT = 'https://svldwcfxhgnqqrdugwzv.supabase.co/rest/v1';

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
            const credentials = JSON.parse(serviceAccountJson);
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
}

module.exports = ToolService;
