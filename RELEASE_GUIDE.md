# Guia de Release - Ambi Chat

Este guia descreve os passos para gerar e publicar uma nova versão do aplicativo.

## 1. Atualizar Versão
Abra o arquivo `package.json` e incremente o número da versão (ex: de `0.1.7` para `0.1.8`).
```json
"version": "0.1.8",
```

## 1.1 Atualizar Frontend
Abra o arquivo `src/App.jsx` e atualize o texto da versão no cabeçalho:
```javascript
Ambi Chat <span ...>v0.1.8</span>
```

## 2. Salvar Alterações
No terminal, registre a alteração da versão:
```powershell
git add .
git commit -m "chore: bump version to v0.1.8"
```
*(Substitua `v0.1.8` pelo número da sua nova versão)*

## 3. Criar Tag de Release
O GitHub Actions está configurado para disparar o build apenas quando uma **Tag** é criada.
```powershell
git tag v0.1.8
```

## 4. Enviar para o GitHub (Disparar Build)
Envie o commit e a tag para o repositório remoto:
```powershell
git push && git push origin v0.1.8
```

## 5. Acompanhar
1. Acesse a aba **Actions** no repositório GitHub para ver o progresso.
2. Quando terminar (ícone verde ✅), o instalador aparecerá na aba **Releases**.

---

## 🛠️ Comandos Úteis

### Build Local (Teste)
Se quiser apenas testar se o executável funciona no seu PC (sem publicar):
```powershell
npm run build:all
npx electron-builder --dir
```
O executável será gerado na pasta `release/win-unpacked`.

### Corrigindo Erros de Upload Local
Se você rodar `npm run release` e receber erro de `GH_TOKEN`, ignore se o seu objetivo for apenas testar localmente. Para publicar oficial, use sempre o fluxo de **Tags** acima.
