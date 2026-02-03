# Ambi Chat

<div align="center">
  <img src="icon.ico" alt="Ambi Chat Logo" width="120" />
  
  **Assistente de IA flutuante para consulta de materiais recicláveis**
  
  [![GitHub Release](https://img.shields.io/github/v/release/AmbientalSC/assistru)](https://github.com/AmbientalSC/assistru/releases)
  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
</div>

---

## 📋 Sobre

**Ambi Chat** é um assistente inteligente desenvolvido pela **Ambiental Limpeza Urbana LTDA** para facilitar consultas sobre descarte correto de materiais recicláveis. A aplicação funciona como uma janela flutuante sempre acessível, permitindo que você:

- 🤖 Faça perguntas sobre descarte de materiais
- 📸 Envie capturas de tela de produtos para identificação
- 🗄️ Consulte banco de dados de materiais recicláveis por cidade
- 🌐 Escolha entre diferentes provedores de IA (Ollama local, Groq, Gemini)

## ✨ Funcionalidades

### Interface Flutuante
- Janela sempre no topo e transparente
- Opacidade ajustável (40-100%)
- Atalho global: `Ctrl+Shift+Space` (Windows) ou `Cmd+Shift+Space` (Mac)
- Botão de acesso rápido flutuante (opcional)

### Múltiplos Provedores de IA
- **Ollama** (execução local, privacidade total)
- **Groq** (rápido e gratuito)
- **Gemini** (Google AI)

### Captura de Tela Inteligente
- Selecione área da tela para capturar
- IA identifica objetos automaticamente
- Consulta banco de dados com informações de descarte

### Banco de Dados Integrado
- Consulta materiais recicláveis via Supabase
- Informações por cidade
- Orientações de descarte específicas
 
 ### 🎙️ Interação por Voz e Transcrição
 - **Gravação de Áudio:** Capture áudio do microfone e/ou do sistema (reuniões, vídeos).
 - **Visualizador em Tempo Real:** Acompanhe os níveis de áudio do microfone (vermelho) e sistema (verde).
 - **Transcrição Inteligente:** O áudio é transcrito e pode ser usado para gerar resumos de reuniões ou anotações automáticas.
 
 ### 🎭 Personalidades Customizáveis
 - Crie assistentes especializados (ex: "Especialista em Leis", "Tutor de Python").
 - Defina **System Prompts** personalizados para moldar o comportamento da IA.
 - Alterne rapidamente entre personalidades no menu de configurações.

## 🚀 Instalação

### Download do Instalador

Baixe a versão mais recente em [Releases](https://github.com/AmbientalSC/assistru/releases):

- **Instalador NSIS** (`Ambi Chat-Setup-X.X.X.exe`): instalação completa com atalhos
- **Versão Portable** (`Ambi Chat-Portable-X.X.X.exe`): executável único, sem instalação

### Instalação via NSIS

1. Execute o instalador `Ambi Chat-Setup-X.X.X.exe`
2. Escolha o diretório de instalação
3. Clique em "Instalar"
4. Inicie pelo menu Iniciar ou atalho na área de trabalho

### Versão Portable

1. Baixe `Ambi Chat-Portable-X.X.X.exe`
2. Execute diretamente (sem instalação)
3. Ideal para uso em USB ou execução temporária

## ⚙️ Configuração

### Primeira Execução

1. Clique no ícone de **Configurações** (engrenagem)
2. Escolha um **Provider** (provedor de IA)
3. Configure as credenciais necessárias

### Provedores Disponíveis

#### Ollama (Local)
- **Endpoint:** `http://localhost:11434` (padrão)
- **Modelo:** `llama3.2-vision` (recomendado para suporte a imagens)
- **Instalação:** [ollama.ai](https://ollama.ai)
- **Vantagens:** privacidade total, sem custos, funciona offline

#### Groq
- **API Key:** obtenha em [console.groq.com](https://console.groq.com)
- **Modelo:** `llama-4-scout-17b-16e-instruct`
- **Vantagens:** ultra rápido, tier gratuito generoso

#### Gemini
- **API Key:** obtenha em [aistudio.google.com](https://aistudio.google.com)
- **Modelo:** `gemini-2.5-flash`
- **Vantagens:** tier gratuito, bom custo-benefício

### Ferramenta de Banco de Dados (Opcional)

Para habilitar consultas ao banco de materiais:

1. Obtenha a **Supabase API Key** (entre em contato com a Ambiental)
2. Vá em Configurações → Geral
3. Cole a API Key no campo **Supabase API Key**
4. Ative **Database Tool**

## 🎮 Uso

### Fazer uma Pergunta
1. Abra o Ambi Chat (`Ctrl+Shift+Space`)
2. Digite sua pergunta: *"Onde descartar pilhas?"*
3. Pressione `Enter` ou clique em enviar

### Consultar com Screenshot
1. Clique no ícone de **câmera**
2. Selecione a área da tela com o objeto
3. Adicione uma pergunta (opcional)
4. Envie

### Atalhos
- `Ctrl+Shift+Space`: Mostrar/ocultar janela
- `Enter`: Enviar mensagem
- `Shift+Enter`: Nova linha no texto
 
 ### Gravação de Voz
 1. Clique no ícone de **microfone**.
 2. Fale ou reproduza o áudio que deseja capturar.
 3. Clique novamente para parar.
 4. O texto transcrito aparecerá no chat ou como contexto para sua pergunta.


## 📝 Licença

Este projeto está licenciado sob a [Licença MIT](LICENSE).

Copyright © 2026 Ambiental Limpeza Urbana LTDA

## 🤝 Suporte

Para dúvidas, problemas ou sugestões:

- 📧 Email: [chamados.ti@ambiental.sc](mailto:chamados.ti@ambiental.sc)
- 🐛 Issues: [GitHub Issues](https://github.com/AmbientalSC/assistru/issues)

---

<div align="center">
  Desenvolvido por Alysson Krombauer
</div>
