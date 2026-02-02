# Documentação de Integração SOFIT API

Este documento descreve tecnicamente como a extensão interage com a API do Sofit para realizar login e consulta de dados (Veículos e Ordens de Serviço).

**Arquivo Principal:** `background.js`

## 1. Autenticação e Login

A extensão utiliza um mecanismo robusto de "tentativa e erro" para obter um token de autenticação (JWT), visto que a API pode responder em diferentes endpoints dependendo da versão ou configuração.

### Credenciais
Atualmente, as credenciais de acesso são **hardcoded** diretamente no código fonte (`background.js`):
- **Usuário:** `integracaoinlog@ambiental.sc`
- **Senha:** *(definida no código)*

### Fluxo de Obtenção de Token (`getSofitToken`)
O sistema tenta obter o token sequencialmente através de dois métodos:

#### A. Endpoints REST (Tentativa Inicial)
A extensão itera sobre uma lista de endpoints conhecidos, testando diferentes formatos de payload JSON:

**Endpoints testados:**
1. `/api/v2/auth/login`
2. `/api/v2/login`
3. `/api/v1/users/login`
4. `/api/auth/login`
5. `/login`

**Payloads testados:**
- `{ email, password }`
- `{ username, password }`
- `{ user, password }`
- `{ user_name, password }`

#### B. GraphQL Mutations (Fallback)
Se todas as tentativas REST falharem, o sistema tenta autenticar via GraphQL no endpoint `https://sofitview.com.br/api/v2/graphql` usando mutations:

1. `mutation { login(...) }`
2. `mutation { authenticate(...) }`
3. `mutation { signIn(...) }`

### Extração do Token
Independente do método, a função `findToken` analisa recursivamente a resposta JSON em busca de qualquer chave que pareça um token (`token`, `jwt`, `access`), validando se o valor é uma string com mais de 50 caracteres.

---

## 2. Consulta de Veículos

Antes de buscar as Ordens de Serviço, é necessário obter o ID interno do veículo no Sofit.

- **Query GraphQL:** `vehicles(page, perPage)`
- **Estratégia de Busca:**
  - A API permite busca por texto, mas a implementação atual realiza uma **varredura em lote** para garantir a identificação correta.
  - O código dispara requisições paralelas para buscar **25 páginas por vez** (lotes de 20 veículos por página).
  - O processamento para assim que encontra um veículo cujo `name` contenha o termo pesquisado (busca sanitizada).

---

## 3. Consulta de Ordens de Serviço

Uma vez identificado o veículo, as Ordens de Serviço (OS) são buscadas.

- **Endpoint:** `https://sofitview.com.br/api/v2/graphql`
- **Query:** `serviceOrders`
- **Parâmetros da Query:**
  - `page`: Paginação controlada pelo usuário (infinite scroll).
  - `perPage`: 20 itens.
  - `lastIntegrationDate`: Define uma janela de tempo de **5 anos** (`Date.now() - 1825 dias`).
  - `search`: Nome do veículo.
  - `sortField`: `created_at` (DESC).

### Tratamento de Dados
A API retorna OS baseadas no termo de busca textual. Para garantir precisão:
1. O backend (`background.js`) recebe os dados.
2. Realiza uma filtragem em memória (`filter`) para manter apenas as OS cujo `vehicle.id` corresponda exatamente ao ID do veículo encontrado no passo anterior.

---

## 4. Paginação (Frontend)

O controle de carga sob demanda é gerenciado em `vehicle_sofit_result.js`:
- O Frontend solicita páginas sequenciais (1, 2, 3...).
- Detecta o scroll do usuário para carregar mais itens automaticamente.
- Se uma página retornar vazia devido ao filtro de ID (ver item 3), o frontend solicita automaticamente a próxima página até preencher a tela ou acabar os registros.
