// Adaptadores por plataforma. Seletores de Teams e Zoom dependem do DOM
// atual de cada serviço e precisam ser validados em chamadas reais.
const PLATFORMS = (() => {
  const text = (el) => `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.toLowerCase().trim();

  function byLabel(selector, labelRe) {
    for (const el of document.querySelectorAll(selector)) {
      if (labelRe.test(text(el))) return el;
    }
    return null;
  }

  // Estado a partir do rótulo: "Mute"/"Turn off" => ligado; "Unmute"/"Turn on" => desligado.
  const OFF_RE = /unmute|turn on|start my|start video|start camera|ativar|reativar|activar|iniciar/;
  const ON_RE = /mute|turn off|stop my|stop video|stop camera|desativar|silenciar|desactivar|desligar|parar|detener/;
  function labelState(btn) {
    const t = text(btn);
    if (OFF_RE.test(t)) return false;
    if (ON_RE.test(t)) return true;
    return null;
  }

  const LEAVE_RE = /leave call|hang up|end call|leave meeting|leave$|sair da chamada|desligar|encerrar|sair|salir de la llamada|colgar|abandonar|disconnect|desconectar/;
  const meetIsOn = (btn) => btn.getAttribute('data-is-muted') === 'false';

  return [
    {
      id: 'meet',
      name: 'Google Meet',
      settingKey: 'platformMeet',
      hostRe: /(^|\.)meet\.google\.com$/,
      urlPrefix: 'https://meet.google.com/',
      // Usa data-is-muted / aria-label, nunca classes (ofuscadas).
      findMic: () => byLabel('[role="button"][data-is-muted], button[data-is-muted]', /microfone|microphone|micrófono/),
      findCam: () => byLabel('[role="button"][data-is-muted], button[data-is-muted]', /câmera|camera|cámara/),
      isOn: meetIsOn,
      inCall: () => !!byLabel('button, [role="button"]', LEAVE_RE),
      micShortcut: 'Ctrl+D',
      micKey: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd',
      camKey: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e'
    },
    {
      id: 'teams',
      name: 'Microsoft Teams',
      settingKey: 'platformTeams',
      hostRe: /(^|\.)teams\.(microsoft|live)\.com$/,
      urlPrefix: 'https://teams.microsoft.com/',
      findMic: () => document.querySelector('#microphone-button, [data-tid="toggle-mute"]')
        || byLabel('button', /\b(un)?mute\b|microphone|microfone/),
      findCam: () => document.querySelector('#video-button, [data-tid="toggle-video"]')
        || byLabel('button', /camera|câmera|video|vídeo/),
      isOn: (btn) => {
        const byText = labelState(btn);
        if (byText !== null) return byText;
        const p = btn.getAttribute('aria-pressed') ?? btn.getAttribute('aria-checked');
        return p === null ? null : p === 'true';
      },
      inCall: () => !!(document.querySelector('#hangup-button, [data-tid="hangup-button"], [data-tid="call-hangup"]')
        || byLabel('button', LEAVE_RE)),
      micShortcut: 'Ctrl+Shift+M',
      micKey: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm',
      camKey: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o'
    },
    {
      id: 'zoom',
      name: 'Zoom',
      settingKey: 'platformZoom',
      hostRe: /(^|\.)zoom\.us$/,
      urlPrefix: 'https://app.zoom.us/wc/',
      pathRe: /^\/wc\//,
      findMic: () => byLabel('button', /(un)?mute( my)? (microphone|audio)|microphone|microfone|silenciar/)
        || document.querySelector('button.join-audio-container__btn'),
      findCam: () => byLabel('button', /(start|stop)( my)? video|câmera|camera|vídeo/)
        || document.querySelector('button.send-video-container__btn'),
      isOn: labelState,
      inCall: () => !!byLabel('button', /^(leave|end)\b|sair|encerrar/),
      micShortcut: 'Alt+A',
      micKey: (e) => e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'a',
      camKey: (e) => e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'v'
    },
    {
      id: 'webex',
      name: 'Webex',
      settingKey: 'platformWebex',
      hostRe: /(^|\.)webex\.com$/,
      urlPrefix: 'https://web.webex.com/',
      findMic: () => byLabel('button', /^(un)?mute\b/),
      findCam: () => byLabel('button', /^(start|stop) video\b/),
      isOn: labelState,
      inCall: () => !!byLabel('button', /^(leave|end)\b/),
      micShortcut: 'Ctrl+M',
      micKey: (e) => (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'm',
      camKey: (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v'
    },
    {
      id: 'whereby',
      name: 'Whereby',
      settingKey: 'platformWhereby',
      hostRe: /(^|\.)whereby\.com$/,
      urlPrefix: 'https://whereby.com/',
      findMic: () => byLabel('button', /^(un)?mute( microphone)?$|toggle microphone|microfone/),
      findCam: () => byLabel('button', /^(start|stop) (camera|video)$|toggle camera|câmera/),
      isOn: labelState,
      inCall: () => !!byLabel('button', /^leave\b|sair/),
      micKey: () => false,
      camKey: () => false
    },
    {
      id: 'slack',
      name: 'Slack Huddles',
      settingKey: 'platformSlack',
      hostRe: /^app\.slack\.com$/,
      urlPrefix: 'https://app.slack.com/',
      // Rótulos exatos: o Slack inteiro roda nesta página, então nada de regex frouxa.
      findMic: () => byLabel('button', /^(un)?mute( (microphone|mic))?$/),
      findCam: () => byLabel('button', /^turn (on|off) (video|camera)$|^(start|stop) video$/),
      isOn: labelState,
      inCall: () => !!byLabel('button', /^leave( huddle)?$/),
      micKey: () => false,
      camKey: () => false
    },
    {
      id: 'discord',
      name: 'Discord',
      settingKey: 'platformDiscord',
      hostRe: /^discord\.com$/,
      urlPrefix: 'https://discord.com/channels/',
      pathRe: /^\/channels\//,
      findMic: () => byLabel('button', /^(un)?mute$/),
      findCam: () => byLabel('button', /^turn (on|off) camera$/),
      isOn: labelState,
      inCall: () => !!byLabel('button', /^disconnect$/),
      micKey: () => false,
      camKey: () => false
    }
  ];
})();

function platformForUrl(url) {
  try {
    const u = new URL(url);
    return PLATFORMS.find((p) => p.hostRe.test(u.hostname) && (!p.pathRe || p.pathRe.test(u.pathname))) || null;
  } catch {
    return null;
  }
}
