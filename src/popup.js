chrome.storage.sync.get({ language: DEFAULTS.language }, ({ language }) => {
setLanguage(language);
(() => {
const MAX = 0.1; // escala do medidor
const $ = (id) => document.getElementById(id);
const save = (k, v) => chrome.storage.sync.set({ [k]: v });

// Force desliga os recursos que conflitam com ele.
const CONFLICTS = {
  forceMute: ['muteOnJoin', 'confirmUnmute'],
  forceCameraOff: ['cameraOffOnJoin', 'confirmCamera']
};

// Textos estáticos do HTML vêm de data-i18n; o inglês no HTML é só fallback.
document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
document.documentElement.lang = uiLang.replace('_', '-');

let current = { ...DEFAULTS };
// '' = regras de todos os sites; senão o id da plataforma cujas proteções estão sendo editadas.
let scope = '';
const overrides = () => (scope && current.platformOverrides?.[scope]) || {};
// Valores que a UI mostra: globais, com as regras do site por cima quando há escopo.
const view = () => ({ ...current, ...overrides() });

function setValue(key, v) {
  if (scope && PROTECTION_KEYS.includes(key)) applyValues({ [key]: v });
  else { current[key] = v; save(key, v); }
  render();
}
function applyValues(values) {
  if (scope) {
    const next = { ...current.platformOverrides, [scope]: { ...overrides(), ...values } };
    current.platformOverrides = next;
    save('platformOverrides', next);
  } else {
    Object.assign(current, values);
    chrome.storage.sync.set(values);
  }
}
const field = (key) => document.querySelector(`[data-key="${key}"]`);

function render() {
  const cur = view();
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = cur[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  const blocked = new Set();
  for (const [k, list] of Object.entries(CONFLICTS)) if (cur[k]) list.forEach((x) => blocked.add(x));
  document.querySelectorAll('[data-key]').forEach((el) => {
    const off = blocked.has(el.dataset.key);
    el.disabled = off;
    el.closest('.row')?.classList.toggle('off', off);
  });
  field('autoMuteSeconds').disabled = !cur.autoMute;
  ['scheduleStart', 'scheduleEnd', 'scheduleWeekdays', 'scheduleProfile'].forEach((k) => (field(k).disabled = !current.scheduleEnabled));
  renderScope();
  $('hero').classList.toggle('paused', !current.enabled);
  $('headSub').textContent = t(current.enabled ? 'p_active' : 'p_paused');
  document.querySelectorAll('.thrVal').forEach((el) => (el.textContent = Number(current.threshold).toFixed(3)));
  document.querySelectorAll('.mark').forEach((el) => (el.style.left = `${Math.min(current.threshold / MAX, 1) * 100}%`));
  renderPlatforms();
  renderTheme();
  renderPresets();
  renderChips();
  renderLanguage();
}

// ---------- Status ----------
function setSt(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = [el.dataset.base, cls].filter(Boolean).join(' ');
}

// Proteções valendo agora no site atual (config efetiva: horário + regras do site).
const PROTECTIONS = [
  ['autoMute', 'p_chipAutoMute'], ['muteOnJoin', 'p_chipMuteJoin'], ['cameraOffOnJoin', 'p_chipCamJoin'],
  ['confirmUnmute', 'p_chipConfMic'], ['confirmCamera', 'p_chipConfCam'], ['mutedTalkWarning', 'p_chipMutedTalk'],
  ['deviceChangeWarning', 'p_chipDeviceChange'], ['warnBeforeClose', 'p_chipWarnClose'],
  ['forceMute', 'p_chipForceMute'], ['forceCameraOff', 'p_chipForceCam']
];

function renderChips() {
  const eff = effectiveConfig(current, activePlatformId);
  const on = PROTECTIONS.filter(([k]) => eff[k]);
  $('chipsTitle').textContent = `${t('p_activeProt')} (${on.length})`;
  const box = $('chips');
  box.innerHTML = '';
  for (const [key, label] of on.length ? on : [[null, 'p_noneEnabled']]) {
    const c = document.createElement('span');
    c.className = !key ? 'chip none' : key.startsWith('force') ? 'chip rose' : 'chip';
    c.textContent = t(label);
    box.appendChild(c);
  }
}

// ---------- Idioma ----------
// Trocar recarrega o popup: todos os textos são montados na inicialização.
function renderLanguage() {
  const sel = $('langSel');
  if (!sel.options.length) {
    sel.add(new Option(t('p_langAuto'), 'auto'));
    for (const [id, name] of LANGUAGES) sel.add(new Option(name, id));
    sel.onchange = () => chrome.storage.sync.set({ language: sel.value }, () => location.reload());
  }
  sel.value = current.language;
}

// ---------- Tema ----------
function renderTheme() {
  const t = current.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
}
document.querySelectorAll('#theme button').forEach((b) => {
  b.onclick = () => { current.theme = b.dataset.theme; save('theme', current.theme); renderTheme(); };
});

document.querySelectorAll('[data-key]').forEach((el) => {
  const key = el.dataset.key;
  const evt = el.type === 'range' ? 'input' : 'change';
  el.addEventListener(evt, () => {
    let v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' || el.type === 'time' ? el.value : +el.value;
    if (el.dataset.min) v = Math.max(+el.dataset.min, v);
    if (el.type === 'time' && !v) return; // campo limpo: mantém o valor salvo
    setValue(key, v);
  });
});

function toggleSection(btn, panel) {
  btn.onclick = () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
    if (btn.id === 'moreBtn') btn.firstElementChild.textContent = t(panel.hidden ? 'p_moreOpts' : 'p_lessOpts');
  };
}
toggleSection($('moreBtn'), $('more'));

// ---------- Plataformas ----------
let activePlatformId = null;

// Plataformas cujos seletores ainda não foram validados em chamadas reais.
const BETA = new Set(['teams', 'zoom', 'webex', 'whereby', 'slack', 'discord']);

const PLATFORM_UI = {
  meet: { icon: 'video', color: 'green' },
  teams: { icon: 'users', color: 'violet' },
  zoom: { icon: 'video', color: 'blue' },
  webex: { icon: 'video', color: 'blue' },
  whereby: { icon: 'video', color: 'violet' },
  slack: { icon: 'users', color: 'amber' },
  discord: { icon: 'users', color: 'violet' }
};

function renderPlatforms() {
  $('platforms').innerHTML = '';
  for (const p of PLATFORMS) {
    const live = p.id === activePlatformId;
    const row = document.createElement('label');
    row.className = 'row plat';
    const ui = PLATFORM_UI[p.id] || { icon: 'globe', color: 'gray' };
    row.innerHTML = `<span class="tile rel ${ui.color}"><svg class="ico"><use href="#i-${ui.icon}"/></svg><i class="dot"></i></span><span class="lbl"><b></b><small></small></span><input type="checkbox" class="switch">`;
    row.querySelector('.dot').classList.toggle('live', live);
    row.querySelector('b').textContent = p.name;
    const note = [live && t('p_activeTab'), BETA.has(p.id) && t('p_beta')].filter(Boolean).join(' · ');
    row.querySelector('small').textContent = note;
    row.querySelector('small').hidden = !note;
    const input = row.querySelector('input');
    input.checked = !!current[p.settingKey];
    input.onchange = () => { current[p.settingKey] = input.checked; save(p.settingKey, input.checked); };
    $('platforms').appendChild(row);
  }
}

chrome.storage.sync.get(DEFAULTS, (cfg) => { current = { ...DEFAULTS, ...cfg }; render(); });

// Medidor ao vivo (Status + área de teste)
function setLevel(level, mic) {
  document.querySelectorAll('.bar').forEach((el) => (el.style.width = `${Math.min(level / MAX, 1) * 100}%`));
  let text, cls;
  if (mic === null) [text, cls] = [t('p_joinCall'), 'chip none'];
  else if (!mic && !level) [text, cls] = [t('p_unmuteTest'), 'chip none'];
  else if (level > current.threshold) [text, cls] = [t('p_voiceDetected'), 'chip ok-chip'];
  else [text, cls] = [t('p_silence'), 'chip'];
  document.querySelectorAll('.testBadge').forEach((b) => { b.textContent = text; b.className = `testBadge ${cls}`; });
}


async function poll() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = tab?.url ? platformForUrl(tab.url) : null;
  if ((platform?.id ?? null) !== activePlatformId) { activePlatformId = platform?.id ?? null; renderPlatforms(); renderChips(); }
  const clear = (silentText = '') => {
    setSt('stMic', ''); setSt('stCam', ''); setSt('stSilent', silentText); setLevel(0, null);
  };
  if (!platform) { setSt('stSite', t('p_noMeeting')); clear(); return; }
  const off = !current[platform.settingKey];
  setSt('stSite', off ? `${platform.name} · ${t('p_stOffHere')}` : platform.name);
  chrome.tabs.sendMessage(tab.id, { type: 'status' }, (res) => {
    if (chrome.runtime.lastError || !res) { clear(t('p_reload')); return; }
    const pill = (id, state, icon, onKey, offKey) => {
      if (state === null) return setSt(id, '');
      setSt(id, `${icon} ${t(state ? onKey : offKey)}`, state ? 'bad' : 'info');
    };
    pill('stMic', res.mic, '🎙️', 'p_live', 'p_muted');
    pill('stCam', res.cam, '📷', 'p_on', 'p_off');
    renderMics(res.mics || []);
    setLevel(res.level, res.mic);
    setSt('stSilent', res.mic ? t('p_silentShort', res.silentFor) : '');
  });
}

// ---------- Perfis (sempre globais; regras por site ficam na aba Proteções) ----------
function renderPresets() {
  const match = matchingPreset(current);
  const sel = $('presetSel');
  if (!sel.options.length) {
    sel.add(new Option(t('p_profileCustom'), ''));
    for (const p of PRESETS) sel.add(new Option(t(p.label), p.id));
    sel.onchange = () => {
      const preset = PRESETS.find((p) => p.id === sel.value);
      if (!preset) return;
      const values = presetValues(preset);
      Object.assign(current, values);
      chrome.storage.sync.set(values);
      render();
    };
  }
  sel.value = match?.id ?? '';
  sel.title = match ? t(match.desc) : '';
}

// ---------- Escopo (regras por site) ----------
function renderScope() {
  const sel = $('scopeSel');
  if (!sel.options.length) {
    sel.add(new Option(t('p_scopeAll'), ''));
    for (const p of PLATFORMS) sel.add(new Option(p.name, p.id));
    sel.onchange = () => { scope = sel.value; render(); };
  }
  sel.value = scope;
  sel.title = t(scope ? 'p_scopeSiteHint' : 'p_scopeAllHint');
  $('scopeReset').hidden = !Object.keys(overrides()).length;
}
$('scopeReset').onclick = () => {
  const next = { ...current.platformOverrides };
  delete next[scope];
  current.platformOverrides = next;
  save('platformOverrides', next);
  render();
};

// Perfil aplicado na janela do agendamento
for (const p of PRESETS) $('scheduleProfile').add(new Option(t(p.label), p.id));

// ---------- Resumo (contadores locais) ----------
function renderStats(stats = {}) {
  $('stAuto').textContent = stats.autoMutes || 0;
  $('stBlocked').textContent = stats.blocked || 0;
  $('stTalk').textContent = stats.mutedTalk || 0;
  $('stPanic').textContent = stats.panic || 0;
  $('statsSince').textContent = stats.since ? t('p_statsSince', new Date(stats.since).toLocaleDateString()) : '';
}
chrome.storage.local.get('stats', ({ stats }) => renderStats(stats));
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.stats) renderStats(c.stats.newValue); });
$('statsReset').onclick = () => chrome.storage.local.remove('stats');

// ---------- Backup ----------
const FULL_TAB = location.search === '?full';
const backupMsg = (text) => { $('backupHint').textContent = text; };

$('exportBtn').onclick = () => {
  const settings = Object.fromEntries(Object.keys(DEFAULTS).filter((k) => k !== 'micDeviceId').map((k) => [k, current[k]]));
  const blob = new Blob([JSON.stringify({ app: 'miccam-guard', version: chrome.runtime.getManifest().version, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'miccam-guard-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// O seletor de arquivo fecha o popup em vários sistemas: a importação roda numa aba.
if (!FULL_TAB) $('importBtn').textContent = t('p_importOpen');
$('importBtn').onclick = () => {
  if (FULL_TAB) $('importFile').click();
  else chrome.tabs.create({ url: `${location.pathname}?full` });
};
$('importFile').onchange = async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const clean = sanitizeSettings(json.settings || json);
    const n = Object.keys(clean).length;
    if (!n) throw new Error('empty');
    Object.assign(current, clean);
    await chrome.storage.sync.set(clean);
    render();
    backupMsg(t('p_importOk', n));
  } catch {
    backupMsg(t('p_importFail'));
  }
};

// ---------- Microfone ----------
function renderMics(mics) {
  const sel = $('micDevice');
  if (sel === document.activeElement) return;
  const sig = JSON.stringify(mics) + current.micDeviceId;
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.innerHTML = '';
  const opts = [{ id: '', label: t('p_micDeviceDefault') }, ...mics];
  if (current.micDeviceId && !mics.some((m) => m.id === current.micDeviceId)) opts.push({ id: current.micDeviceId, label: t('p_micDeviceDefault') + '*' });
  for (const m of opts) sel.add(new Option(m.label, m.id));
  sel.value = current.micDeviceId;
}

// ---------- Notificação de teste ----------
$('notifyTestBtn').onclick = () => {
  const hint = $('notifyHint');
  hint.textContent = '';
  chrome.runtime.sendMessage({ type: 'testNotify' }, (res) => {
    if (chrome.runtime.lastError || !res) hint.textContent = t('p_notifyError', chrome.runtime.lastError?.message || '?');
    else if (res.ok) hint.textContent = t('p_notifySent');
    else if (res.level === 'denied') hint.textContent = t('p_notifyDenied');
    else hint.textContent = t('p_notifyError', res.error || '?');
  });
};

// ---------- Pânico ----------
$('panicBtn').onclick = () => chrome.runtime.sendMessage({ type: 'panicAll' });
chrome.commands.getAll((cmds) => {
  const key = cmds.find((c) => c.name === 'panic')?.shortcut;
  $('panicHint').textContent = key ? t('p_panicHint', key) : t('p_panicNoKey');
});

// ---------- Abas ----------
function showTab(id) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== id));
  try { localStorage.setItem('tab', id); } catch { /* sem storage: abre sempre em Início */ }
}
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
let startTab = 'home';
try { startTab = localStorage.getItem('tab') || 'home'; } catch { /* idem */ }
// A importação abre numa aba cheia, já em Ajustes
showTab(FULL_TAB ? 'settings' : document.querySelector(`[data-tab="${startTab}"]`) ? startTab : 'home');

setInterval(poll, 150);
poll();
})();
});
