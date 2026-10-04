(() => {
  const platform = platformForUrl(location.href);
  if (!platform) return;

  let raw = { ...DEFAULTS };
  let cfg = effectiveConfig(raw, platform.id);
  // Config efetiva = base + perfil do horário + regras do site; recalculada a cada 5 s
  // para pegar a entrada/saída da janela de agendamento.
  const rebuild = () => { cfg = effectiveConfig(raw, platform.id); };
  // Depois que a extensão é recarregada/atualizada, o script antigo continua na aba mas perde
  // o acesso às APIs: sendMessage lança "Extension context invalidated". Nada de quebrar o loop.
  const contextAlive = () => !!chrome.runtime?.id;
  const send = (msg) => {
    if (!contextAlive()) return;
    try { chrome.runtime.sendMessage(msg)?.catch?.(() => {}); } catch { /* contexto invalidado */ }
  };
  const stat = (name) => send({ type: 'stat', name });
  let stream = null, ctx = null, analyser = null, buf = null;
  let lastVoice = Date.now();
  let lastWarn = 0;
  let currentLevel = 0;
  let overlay = null;

  chrome.storage.sync.get(DEFAULTS, (v) => { raw = { ...DEFAULTS, ...v }; rebuild(); setLanguage(raw.language); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) raw[k] = newValue;
    rebuild();
    if ('language' in changes) { setLanguage(raw.language); hideOverlay(); } // o aviso reaparece já no novo idioma
    if (!active()) { hideOverlay(); stopAudio(); }
    else if ('micDeviceId' in changes) stopAudio(); // o loop reabre no dispositivo novo
  });

  const active = () => raw.enabled && raw[platform.settingKey];

  // ---------- Estado de microfone e câmera ----------
  const findMicButton = () => platform.findMic();
  const findCamButton = () => platform.findCam();

  function stateOf(btn) {
    return btn ? platform.isOn(btn) : null;
  }

  // true = ligado, false = mudo, null = fora de chamada
  const micState = () => stateOf(findMicButton());
  const camState = () => stateOf(findCamButton());

  // ---------- Áudio ----------
  async function startAudio() {
    if (stream) return;
    try {
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: false };
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: cfg.micDeviceId ? { ...audio, deviceId: { exact: cfg.micDeviceId } } : audio
        });
      } catch (e) {
        // Dispositivo salvo não existe mais: volta ao padrão do sistema
        if (!cfg.micDeviceId || e.name !== 'OverconstrainedError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      // Passa-banda na faixa da voz para reduzir ruído ambiente
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1000;
      band.Q.value = 0.7;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      src.connect(band).connect(analyser);
      lastVoice = Date.now();
    } catch (e) {
      console.warn('[MicCam Guard] getUserMedia falhou:', e);
      stopAudio();
    }
  }

  function stopAudio() {
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    stream = ctx = analyser = buf = null;
    currentLevel = 0;
  }

  async function listMics() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch {
      return [];
    }
  }

  function rms() {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  // ---------- Aviso ----------
  function showOverlay(seconds) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mmg-overlay';
      overlay.innerHTML = `
        <div class="mmg-icon">🎙️</div>
        <div class="mmg-text">
          <strong></strong>
          <span class="mmg-sub"></span>
        </div>
        <button class="mmg-mute"></button>
        <button class="mmg-close">✕</button>`;
      overlay.querySelector('strong').textContent = t('c_micLive');
      overlay.querySelector('.mmg-mute').textContent = t('c_mute');
      overlay.querySelector('.mmg-close').title = t('c_dismiss');
      overlay.querySelector('.mmg-close').onclick = () => { hideOverlay(); lastWarn = Date.now(); };
      overlay.querySelector('.mmg-mute').onclick = () => { findMicButton()?.click(); hideOverlay(); };
      if (platform.micShortcut) overlay.querySelector('.mmg-mute').title = t('c_muteTitle', platform.micShortcut);
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.mmg-sub').textContent = subText(seconds);
    overlay.classList.remove('mmg-pulse');
    void overlay.offsetWidth; // reinicia animação
    overlay.classList.add('mmg-pulse');
  }

  function subText(seconds) {
    if (!cfg.autoMute) return t('c_silentFor', seconds);
    return t('c_silentAuto', [seconds, Math.max(0, cfg.autoMuteSeconds - seconds)]);
  }

  function hideOverlay() {
    overlay?.remove();
    overlay = null;
  }

  // O botão do Meet pode levar mais que um tick (200 ms) para refletir o clique. Sem esta
  // trava o loop clicaria de novo, religando o mic e repetindo a notificação.
  const AUTO_MUTE_COOLDOWN_MS = 5000;
  let lastAutoMute = 0;

  function autoMute(seconds) {
    const btn = findMicButton();
    if (!btn || Date.now() - lastAutoMute < AUTO_MUTE_COOLDOWN_MS) return;
    lastAutoMute = Date.now();
    btn.click();
    stat('autoMutes');
    hideOverlay();
    showToast(t('c_autoMuted', seconds));
    if (cfg.nativeNotification && document.hidden) {
      send({ type: 'notify', kind: 'autoMuted', seconds });
    }
  }

  function showToast(text) {
    const t = document.createElement('div');
    t.id = 'mmg-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function warn(seconds) {
    showOverlay(seconds);
    if (cfg.nativeNotification && document.hidden) {
      send({ type: 'notify', kind: 'silent', seconds });
    }
  }

  // ---------- Proteções ----------
  const JOIN_STABLE_TICKS = 5;   // botões presentes ~1s antes de agir
  const JOIN_RESET_TICKS = 15;   // botões ausentes ~3s = nova chamada
  let presentTicks = 0, missingTicks = 0, joinApplied = false;
  let lastForceMic = 0, lastForceCam = 0;

  function protect(mic, cam, now) {
    if (mic === null && cam === null) {
      presentTicks = 0;
      if (++missingTicks >= JOIN_RESET_TICKS) joinApplied = false;
      return;
    }
    missingTicks = 0;
    presentTicks++;

    if (!joinApplied && presentTicks >= JOIN_STABLE_TICKS) {
      joinApplied = true;
      if (cfg.muteOnJoin && mic === true) { findMicButton()?.click(); showToast(t('c_mutedJoin')); }
      if (cfg.cameraOffOnJoin && cam === true) { findCamButton()?.click(); showToast(t('c_camOffJoin')); }
    }
    if (cfg.forceMute && mic === true && now - lastForceMic > 1000) {
      lastForceMic = now;
      findMicButton()?.click();
      stat('blocked');
      showToast(t('c_forcedMute'));
    }
    if (cfg.forceCameraOff && cam === true && now - lastForceCam > 1000) {
      lastForceCam = now;
      findCamButton()?.click();
      stat('blocked');
      showToast(t('c_forcedCam'));
    }
  }

  // ---------- Confirmação antes de ligar ----------
  function askConfirm({ icon, title, sub, ok }, onYes) {
    document.getElementById('mmg-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'mmg-modal';
    m.setAttribute('role', 'alertdialog');
    m.innerHTML = `
      <div class="mmg-icon"></div>
      <div class="mmg-text"><strong></strong><span class="mmg-sub"></span></div>
      <button class="mmg-ok"></button>
      <button class="mmg-cancel">✕</button>`;
    m.querySelector('.mmg-cancel').title = t('c_cancel');
    m.querySelector('.mmg-icon').textContent = icon;
    m.querySelector('strong').textContent = title;
    m.querySelector('.mmg-sub').textContent = sub;
    m.querySelector('.mmg-ok').textContent = ok;
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
    const dismiss = () => { close(); stat('blocked'); }; // confirmação recusada = ativação acidental evitada
    const onKey = (e) => { if (e.key === 'Escape' && e.isTrusted) dismiss(); };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('.mmg-cancel').onclick = dismiss;
    m.querySelector('.mmg-ok').onclick = () => { close(); onYes(); };
    document.body.appendChild(m);
    m.querySelector('.mmg-ok').focus();
  }

  // Cliques/atalhos reais (isTrusted) são interceptados; o click() programático da
  // extensão não é confiável e passa direto.
  // Função (e não constante) para respeitar uma troca de idioma sem recarregar a página.
  const confirms = () => ({
    mic: { icon: '🎙️', title: t('c_confirmMicTitle'), sub: t('c_confirmMicSub'), ok: t('c_turnOn') },
    cam: { icon: '📷', title: t('c_confirmCamTitle'), sub: t('c_confirmCamSub'), ok: t('c_turnOn') }
  });

  // Retorna 'block' (force ativo), 'confirm' ou null.
  function guardMode(kind) {
    if (!active()) return null;
    if (kind === 'mic' && micState() === false) {
      if (cfg.forceMute) return 'block';
      if (cfg.confirmUnmute) return 'confirm';
    }
    if (kind === 'cam' && camState() === false) {
      if (cfg.forceCameraOff) return 'block';
      if (cfg.confirmCamera) return 'confirm';
    }
    return null;
  }

  function intercept(e, kind) {
    const mode = guardMode(kind);
    if (!mode) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (mode === 'block') {
      stat('blocked');
      showToast(t(kind === 'mic' ? 'c_blockedMic' : 'c_blockedCam'));
      return true;
    }
    const btn = kind === 'mic' ? findMicButton() : findCamButton();
    askConfirm(confirms()[kind], () => btn?.click());
    return true;
  }

  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const mic = findMicButton(), cam = findCamButton();
    if (mic?.contains(e.target)) intercept(e, 'mic');
    else if (cam?.contains(e.target)) intercept(e, 'cam');
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    if (platform.micKey(e)) intercept(e, 'mic');
    else if (platform.camKey(e)) intercept(e, 'cam');
  }, true);

  // ---------- Aviso ao fechar ----------
  window.addEventListener('beforeunload', (e) => {
    if (!active() || !cfg.warnBeforeClose) return;
    if (!platform.inCall()) return; // lobby/pré-entrada não conta como chamada
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- Falando mutado ----------
  const MUTED_TALK_MS = 1500;     // tempo de fala acumulado antes de avisar
  const MUTED_TALK_REPEAT = 15000;
  // Fala tem pausas entre palavras: o acumulador sobe com voz e desce pela metade do
  // tempo com silêncio, então ~1/3 de atividade já basta e só silêncio longo zera.
  let voiceMs = 0, lastMutedTick = 0, lastMutedTalk = 0;

  function checkMutedTalk(now) {
    const dt = lastMutedTick ? Math.min(now - lastMutedTick, 1000) : 0;
    lastMutedTick = now;
    voiceMs = currentLevel > cfg.threshold ? voiceMs + dt : Math.max(0, voiceMs - dt / 2);
    if (voiceMs < MUTED_TALK_MS || now - lastMutedTalk < MUTED_TALK_REPEAT) return;
    voiceMs = 0;
    lastMutedTalk = now;
    stat('mutedTalk');
    showToast(t('c_mutedTalk'));
    if (cfg.nativeNotification && document.hidden) {
      send({ type: 'notify', kind: 'mutedTalk' });
    }
  }

  // ---------- Dispositivo de áudio removido com o mic aberto ----------
  async function audioDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return new Set(all.filter((d) => d.kind.startsWith('audio')).map((d) => `${d.kind}:${d.deviceId}`));
    } catch {
      return null;
    }
  }
  let knownDevices = null;
  audioDevices().then((d) => (knownDevices = d));
  navigator.mediaDevices?.addEventListener('devicechange', async () => {
    const before = knownDevices;
    knownDevices = await audioDevices();
    if (!before || !knownDevices || !active() || !cfg.deviceChangeWarning) return;
    const removed = [...before].some((id) => !knownDevices.has(id));
    if (!removed || micState() !== true) return;
    showToast(t('c_deviceLost'));
    if (cfg.nativeNotification && document.hidden) send({ type: 'notify', kind: 'deviceLost' });
  });

  // ---------- Loop ----------
  let prevOn = null;

  let lastRebuild = 0;
  let staleWarned = false;
  setInterval(async () => {
    if (!contextAlive()) {      // extensão recarregada: este script está órfão, só dá para avisar
      if (!staleWarned) { staleWarned = true; showToast(t('c_reloadTab')); }
      return;
    }
    const now0 = Date.now();
    if (now0 - lastRebuild > 5000) { lastRebuild = now0; rebuild(); }
    if (!active()) return;
    const on = micState();
    const now = Date.now();
    protect(on, camState(), now);

    if (on === true && prevOn !== true) lastVoice = now; // recomeça a contagem de silêncio
    prevOn = on;
    if (on !== false) { voiceMs = 0; lastMutedTick = 0; }

    if (on === null) {          // fora da chamada
      stopAudio();
      hideOverlay();
      return;
    }

    if (on === false) {         // mudo: só escuta se o aviso de "falando mutado" estiver ligado
      hideOverlay();
      if (!(cfg.mutedTalkWarning && platform.inCall())) { stopAudio(); return; }
      await startAudio();
      currentLevel = rms();
      checkMutedTalk(now);
      return;
    }

    await startAudio();
    currentLevel = rms();

    if (currentLevel > cfg.threshold) {
      lastVoice = now;
      hideOverlay();
      return;
    }

    const silentMs = now - lastVoice;
    if (cfg.autoMute && silentMs >= cfg.autoMuteSeconds * 1000) {
      autoMute(Math.round(silentMs / 1000));
      return;
    }
    if (silentMs >= cfg.silenceSeconds * 1000 && now - lastWarn >= cfg.repeatSeconds * 1000) {
      lastWarn = now;
      warn(Math.round(silentMs / 1000));
    } else if (overlay) {
      overlay.querySelector('.mmg-sub').textContent = subText(Math.round(silentMs / 1000));
    }
  }, 200);

  // Popup consulta o nível atual (calibração) e a lista de microfones
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'status') {
      listMics().then((mics) => reply({
        platform: platform.id, mic: micState(), cam: camState(), level: currentLevel,
        silentFor: Math.round((Date.now() - lastVoice) / 1000), mics
      }));
      return true; // resposta assíncrona
    }
    if (msg.type === 'panic') {
      // Ação explícita do usuário: vale mesmo com a proteção pausada
      let acted = false;
      if (micState() === true) { findMicButton()?.click(); acted = true; }
      if (camState() === true) { findCamButton()?.click(); acted = true; }
      if (acted) { stat('panic'); showToast(t('c_panicDone')); }
    }
  });
})();
