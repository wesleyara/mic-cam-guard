# MicCam Guard

Extensão Chrome (MV3) que protege seu microfone e câmera em reuniões online no **Google Meet**, **Microsoft Teams** e **Zoom** (web client): avisa quando o mic está ligado e você não fala, muta e desliga a câmera ao entrar, pede confirmação antes de ligar e mais.

Tudo roda localmente no navegador. Nenhum áudio, vídeo ou dado sai do seu computador; as configurações ficam em `chrome.storage.sync`.

## Instalação

**Chrome Web Store** (quando publicada): busque por *MicCam Guard* e clique em **Adicionar ao Chrome**.

**Pelo GitHub**
1. Baixe o zip da última [Release](../../releases) e extraia, ou clone o repositório.
2. `chrome://extensions` → ative **Modo do desenvolvedor**.
3. **Carregar sem compactação** → selecione a pasta do projeto (a que contém `manifest.json`).
4. Entre numa chamada (recarregue a aba se ela já estava aberta).

## Recursos

Todos ficam no popup e valem na hora, sem recarregar a aba.

**Protection**
| Opção | O que faz |
|---|---|
| Auto Mute | Muta após N s de silêncio (`autoMuteSeconds`); o overlay mostra a contagem regressiva. |
| Mute on Join | Entra sempre mutado. |
| Auto Camera Off | Desliga a câmera ao entrar. |
| Confirm Before Unmute / Camera | Modal de confirmação ao ligar mic ou câmera, por clique ou atalho (Meet `Ctrl+D`/`Ctrl+E`, Teams `Ctrl+Shift+M`/`O`, Zoom `Alt+A`/`Alt+V`). |

**More options**
| Opção | O que faz |
|---|---|
| Always Force Mute / Camera Off | Bloqueia ligar mic/câmera (com aviso) e desfaz qualquer tentativa. Tem precedência sobre Confirm e sobre Mute/Camera on Join, que ficam desabilitados no popup. |
| Warn Before Close | Pede confirmação ao fechar ou recarregar a aba durante uma chamada. |

**Silence config** (recolhível): notificação nativa, avisar após silêncio, repetir aviso, Auto Mute após N s, sensibilidade e área de teste.

**Status**: site atual, estado da proteção, mic, câmera, tempo de silêncio, nível de voz ao vivo e as proteções ativas.

**Platforms**: liga/desliga cada plataforma; o ponto verde marca a aba atual.

**Theme**: claro, escuro ou do sistema.

## Como funciona
- `src/platforms.js` define um adaptador por plataforma (como achar os botões de mic/câmera e se estão ligados). O Meet usa `data-is-muted` + `aria-label`, nunca classes ofuscadas.
- `src/content.js` roda em cada aba suportada: aplica as proteções num loop de 200 ms, intercepta cliques/atalhos (só eventos reais, `isTrusted`) e registra um `beforeunload`.
- Com o mic ligado, abre um stream próprio (`getUserMedia`) → filtro passa-banda 1 kHz → `AnalyserNode` → RMS. O stream é fechado ao mutar ou sair da chamada.
- Silêncio ≥ `silenceSeconds` → overlay na página (botão **Mutar**), repetido a cada `repeatSeconds`.
- Aba em segundo plano → notificação nativa via `src/background.js`; clicar nela foca a aba.
- `src/defaults.js` guarda as configurações padrão, compartilhadas por popup e content script.

## Calibração
No popup, o **Status** mostra o nível de voz ao vivo (barra verde) e o limiar (linha vermelha), com um selo *Silence* / *Voice detected*. Ajuste o slider de **Sensitivity** (no próprio Status ou na Silence config) até a fala passar da linha e o silêncio ficar abaixo. O mic precisa estar ligado numa chamada.

## Empacotar
`./package.sh` gera `dist/miccam-guard-<versão>.zip` (manifest + `src/`), pronto para a Chrome Web Store e para anexar a uma Release do GitHub.

## Limitações
- **Teams e Zoom:** os seletores dependem do DOM atual de cada serviço e ainda precisam ser validados em chamadas reais. O app desktop do Zoom não é suportado, só o web client (`*.zoom.us/wc/*`).
- Os serviços mudam o DOM com frequência. Se parar de detectar, ajuste o adaptador da plataforma em `src/platforms.js`.
- Warn Before Close também dispara na tela de pré-entrada, porque os botões de mic/câmera já existem lá.
- O stream usa o dispositivo de áudio **padrão** do sistema. Se a chamada usar outro mic, passe `deviceId` no `getUserMedia`.
- Os avisos dentro da página estão em português; o popup está em inglês. Não há i18n.
- Só existe `icon128.png`; a Web Store pede também 16, 32 e 48 px.
