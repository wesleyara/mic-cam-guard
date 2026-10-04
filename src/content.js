(() => {
  const platform = platformForUrl(location.href);
  if (!platform) return;

  let cfg = { ...DEFAULTS };
  let stream = null, ctx = null, analyser = null, buf = null;
  let lastVoice = Date.now();
  let lastWarn = 0;
  let currentLevel = 0;
  let overlay = null;

  chrome.storage.sync.get(DEFAULTS, (v) => (cfg = { ...DEFAULTS, ...v }));
  chrome.storage.onChanged.addListener((changes) => {
    for (const [k, { newValue }] of Object.entries(changes)) cfg[k] = newValue;
    if (!active()) { hideOverlay(); stopAudio(); }
  });

  const active = () => cfg.enabled && cfg[platform.settingKey];

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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }
      });
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
          <strong>Microfone ligado</strong>
          <span class="mmg-sub"></span>
        </div>
        <button class="mmg-mute" title="Mutar (Ctrl+D)">Mutar</button>
        <button class="mmg-close" title="Dispensar">✕</button>`;
      overlay.querySelector('.mmg-close').onclick = () => { hideOverlay(); lastWarn = Date.now(); };
      overlay.querySelector('.mmg-mute').onclick = () => { findMicButton()?.click(); hideOverlay(); };
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.mmg-sub').textContent = subText(seconds);
    overlay.classList.remove('mmg-pulse');
    void overlay.offsetWidth; // reinicia animação
    overlay.classList.add('mmg-pulse');
  }

  function subText(seconds) {
    if (!cfg.autoMute) return `Você não fala há ${seconds}s`;
    const left = Math.max(0, cfg.autoMuteSeconds - seconds);
    return `Você não fala há ${seconds}s · auto-mute em ${left}s`;
  }

  function hideOverlay() {
    overlay?.remove();
    overlay = null;
  }

  function autoMute(seconds) {
    const btn = findMicButton();
    if (!btn) return;
    btn.click();
    hideOverlay();
    showToast(`Microfone mutado automaticamente após ${seconds}s de silêncio`);
    if (cfg.nativeNotification && document.hidden) {
      chrome.runtime.sendMessage({ type: 'notify', seconds, autoMuted: true });
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
      chrome.runtime.sendMessage({ type: 'notify', seconds });
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
      if (cfg.muteOnJoin && mic === true) { findMicButton()?.click(); showToast('Microfone mutado ao entrar'); }
      if (cfg.cameraOffOnJoin && cam === true) { findCamButton()?.click(); showToast('Câmera desligada ao entrar'); }
    }
    if (cfg.forceMute && mic === true && now - lastForceMic > 1000) {
      lastForceMic = now;
      findMicButton()?.click();
      showToast('Microfone forçado para mudo');
    }
    if (cfg.forceCameraOff && cam === true && now - lastForceCam > 1000) {
      lastForceCam = now;
      findCamButton()?.click();
      showToast('Câmera forçada para desligada');
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
      <button class="mmg-cancel" title="Cancelar">✕</button>`;
    m.querySelector('.mmg-icon').textContent = icon;
    m.querySelector('strong').textContent = title;
    m.querySelector('.mmg-sub').textContent = sub;
    m.querySelector('.mmg-ok').textContent = ok;
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && e.isTrusted) close(); };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('.mmg-cancel').onclick = close;
    m.querySelector('.mmg-ok').onclick = () => { close(); onYes(); };
    document.body.appendChild(m);
    m.querySelector('.mmg-ok').focus();
  }

  // Cliques/atalhos reais (isTrusted) são interceptados; o click() programático da
  // extensão não é confiável e passa direto.
  const CONFIRMS = {
    mic: { icon: '🎙️', title: 'Ligar o microfone?', sub: 'Ele ficará aberto para a chamada', ok: 'Ligar' },
    cam: { icon: '📷', title: 'Ligar a câmera?', sub: 'Ela ficará visível para a chamada', ok: 'Ligar' }
  };

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
      showToast(kind === 'mic' ? 'Microfone bloqueado em mudo' : 'Câmera bloqueada desligada');
      return true;
    }
    const btn = kind === 'mic' ? findMicButton() : findCamButton();
    askConfirm(CONFIRMS[kind], () => btn?.click());
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
    if (micState() === null && camState() === null) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- Loop ----------
  setInterval(async () => {
    if (!active()) return;
    const on = micState();
    const now = Date.now();
    protect(on, camState(), now);

    if (on !== true) {          // mudo ou fora da chamada
      stopAudio();
      hideOverlay();
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

  // Popup consulta o nível atual para calibração
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'status') {
      reply({ platform: platform.id, mic: micState(), cam: camState(), level: currentLevel, silentFor: Math.round((Date.now() - lastVoice) / 1000) });
    }
  });
})();
