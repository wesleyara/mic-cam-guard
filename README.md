# MicCam Guard

Extensão Chrome (MV3) que protege seu microfone e câmera em reuniões online no **Google Meet**, **Microsoft Teams** e **Zoom** (web client), além de Webex, Whereby, Slack Huddles e Discord (beta): avisa quando o mic está ligado e você não fala, muta e desliga a câmera ao entrar, pede confirmação antes de ligar e mais.

Tudo roda localmente no navegador. Nenhum áudio, vídeo ou dado sai do seu computador; as configurações ficam em `chrome.storage.sync`.

## Instalação

**Chrome Web Store** (quando publicada): busque por *MicCam Guard* e clique em **Adicionar ao Chrome**.

**Pelo GitHub**
1. Baixe o zip da última [Release](../../releases) e extraia, ou clone o repositório.
2. `chrome://extensions` → ative **Modo do desenvolvedor**.
3. **Carregar sem compactação** → selecione a pasta do projeto (a que contém `manifest.json`).
4. Entre numa chamada (recarregue a aba se ela já estava aberta).

## Recursos

O popup tem três abas. Tudo vale na hora, sem recarregar a aba. O idioma segue o navegador por padrão (português ou inglês) e pode ser trocado em **Ajustes → Idioma**; vale para o popup, os avisos na página e as notificações. O nome e a descrição da extensão na Web Store e o atalho em `chrome://extensions/shortcuts` seguem sempre o idioma do navegador (limitação do Chrome).

### Início
Site atual, estado do mic e da câmera, nível de voz ao vivo (barra verde) com o limiar (linha vermelha), **Sensibilidade**, **Perfis** e o botão de **Pânico**.

- **Perfis** (valem para todos os sites): *Reunião grande*, *1:1*, *Apresentando* e *Rígido* trocam um conjunto de proteções com um clique. Mexer em qualquer opção depois vira *Personalizado*.
- **Pânico** (`Alt+Shift+M`, mude em `chrome://extensions/shortcuts`): muta o mic e desliga a câmera em todas as abas de reunião. Funciona mesmo com a proteção pausada.

### Proteções
| Opção | O que faz |
|---|---|
| Auto Mute | Muta após N s de silêncio; o overlay mostra a contagem regressiva. |
| Mute on Join / Auto Camera Off | Entra sempre mutado / com a câmera desligada. |
| Confirm Before Unmute / Camera | Modal de confirmação ao ligar, por clique ou atalho. |
| Talking While Muted | Avisa quando você fala com o mic mutado. Mantém o mic aberto só para medir o nível (nada é gravado). |
| Device Change Warning | Avisa se fone ou mic desconectar com o mic aberto. |
| Warn Before Close | Confirma antes de fechar ou recarregar a aba durante uma chamada (não dispara na tela de pré-entrada). |
| Always Force Mute / Camera Off (*Mais opções*) | Bloqueia ligar (com aviso) e desfaz qualquer tentativa. Tem precedência sobre Confirm e sobre Mute/Camera on Join, que ficam desabilitados. |

**Regras por site:** o seletor *Regras para* edita as proteções só daquele site (ex.: Force Mute no Teams e só Confirm no Meet). O botão ↺ volta às regras de todos os sites.

### Ajustes (seções recolhíveis)
- **Silêncio e áudio:** microfone usado na medição, avisar após N s, repetir a cada N s, Auto Mute após N s e notificação nativa.
- **Agendamento:** numa janela de horário (opcionalmente só dias úteis) aplica um perfil mais forte. O perfil só *liga* proteções, nunca desliga, e a regra de um site específico vence. A janela pode atravessar a meia-noite.
- **Plataformas:** liga/desliga cada uma. Teams, Zoom, Webex, Whereby, Slack e Discord estão em beta; Webex, Whereby, Slack e Discord começam desligadas.
- **Dados:** contadores locais (mutes automáticos, acidentes evitados, alertas de fala mutada, usos do pânico), exportar e importar configurações em JSON (a importação abre uma aba porque o seletor de arquivo fecha o popup). Nada disso sai do navegador.
- **Idioma** e **Tema** (claro, escuro ou do sistema).

## Como funciona
- `src/platforms.js`: um adaptador por plataforma (como achar os botões de mic/câmera, se estão ligados e se há uma chamada em andamento). O Meet usa `data-is-muted` + `aria-label`, nunca classes ofuscadas.
- `src/content.js` roda em cada aba suportada: aplica as proteções num loop de 200 ms, intercepta cliques/atalhos (só eventos reais, `isTrusted`) e registra um `beforeunload`.
- Com o mic ligado (ou mutado, se *Talking While Muted* estiver ativo), abre um stream próprio (`getUserMedia`) → filtro passa-banda 1 kHz → `AnalyserNode` → RMS. O stream é fechado ao sair da chamada.
- Silêncio ≥ limite → overlay na página (botão **Mutar**), repetido no intervalo configurado.
- `src/background.js`: notificações nativas (clicar foca a aba), atalho de pânico e contadores (em fila, para não perder incrementos de várias abas).
- `src/defaults.js`: configurações padrão, perfis, agendamento, configuração efetiva por site e validação da importação, compartilhados por popup, content script e service worker.
- `_locales/`: textos em `en` e `pt_BR` (fonte da verdade). Como o `chrome.i18n` não permite trocar o idioma por dentro da extensão, `tools/build-messages.js` gera `src/messages.js` a partir deles e `t()` (em `defaults.js`) usa esse arquivo.
- `src/fonts/`: Inter e Barlow empacotadas (licença OFL, arquivos `OFL-*.txt`), então a interface funciona offline e sem chamadas externas.

## Calibração
Na aba **Início**, ajuste a **Sensibilidade** até a fala passar da linha vermelha e o silêncio ficar abaixo. O mic precisa estar ligado numa chamada. Quem fala baixo com o mic mutado pode precisar de um limiar menor para o aviso *Talking While Muted*.

## Desenvolvimento
- Sem build para o código: carregue a pasta em `chrome://extensions` (Modo do desenvolvedor).
- **Depois de editar qualquer texto em `_locales/`, rode `node tools/build-messages.js`.** Um teste falha se `src/messages.js` ficar desatualizado.
- Para acrescentar um idioma: crie `_locales/<código>/messages.json` com as mesmas chaves, rode o build e inclua o idioma em `LANGUAGES` (`src/defaults.js`).
- Testes da lógica compartilhada (perfis, agendamento, config por site, importação, roteamento de URL, manifest e i18n): `node --test test/defaults.test.js`.
- `./package.sh` gera `dist/miccam-guard-<versão>.zip` (manifest, `src/` e `_locales/`), pronto para a Chrome Web Store e para uma Release do GitHub.

## Limitações
- **Seletores não validados:** Teams, Zoom, Webex, Whereby, Slack e Discord dependem do DOM atual de cada serviço e ainda precisam ser testados em chamadas reais. Os serviços mudam o DOM com frequência; se parar de detectar, ajuste o adaptador em `src/platforms.js`. O app desktop do Zoom não é suportado, só o web client (`*.zoom.us/wc/*`).
- Atalhos de teclado interceptados existem só para Meet, Teams, Zoom e Webex; nas demais, só o clique é interceptado.
- A Web Store pode questionar as permissões de host das plataformas em beta.
