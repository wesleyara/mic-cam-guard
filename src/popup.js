const MAX = 0.1; // escala do medidor
const $ = (id) => document.getElementById(id);
const save = (k, v) => chrome.storage.sync.set({ [k]: v });

// Force desliga os recursos que conflitam com ele.
const CONFLICTS = {
  forceMute: ['muteOnJoin', 'confirmUnmute'],
  forceCameraOff: ['cameraOffOnJoin', 'confirmCamera']
};

let current = { ...DEFAULTS };
const field = (key) => document.querySelector(`[data-key="${key}"]`);

function render() {
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = current[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  const blocked = new Set();
  for (const [k, list] of Object.entries(CONFLICTS)) if (current[k]) list.forEach((x) => blocked.add(x));
  document.querySelectorAll('[data-key]').forEach((el) => {
    const off = blocked.has(el.dataset.key);
    el.disabled = off;
    el.closest('.row')?.classList.toggle('off', off);
  });
  field('autoMuteSeconds').disabled = !current.autoMute;
  $('hero').classList.toggle('paused', !current.enabled);
  $('headSub').textContent = current.enabled ? 'Protection is active' : 'Protection is paused';
  document.querySelectorAll('.thrVal').forEach((el) => (el.textContent = Number(current.threshold).toFixed(3)));
  document.querySelectorAll('.mark').forEach((el) => (el.style.left = `${Math.min(current.threshold / MAX, 1) * 100}%`));
  renderPlatforms();
  renderTheme();
  renderChips();
  const p = PLATFORMS.find((x) => x.id === activePlatformId);
  setSt('stProt', !current.enabled ? 'Paused' : p && !current[p.settingKey] ? 'Off here' : 'Active',
    !current.enabled ? 'warn' : p && !current[p.settingKey] ? 'warn' : 'ok');
}

// ---------- Status ----------
const PROTECTIONS = [
  ['autoMute', 'Auto-mute'], ['muteOnJoin', 'Mute on join'], ['cameraOffOnJoin', 'Auto-camera off'],
  ['confirmUnmute', 'Mic confirmation'], ['confirmCamera', 'Camera confirmation'],
  ['forceMute', 'Force mute'], ['forceCameraOff', 'Force camera off'], ['warnBeforeClose', 'Close warning']
];

function setSt(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = cls || '';
}

function renderChips() {
  const on = PROTECTIONS.filter(([k]) => current[k]);
  $('chipsTitle').textContent = `Active protections (${on.length})`;
  $('chips').innerHTML = '';
  for (const [, label] of on.length ? on : [[0, 'None enabled']]) {
    const c = document.createElement('span');
    c.className = on.length ? 'chip' : 'chip none';
    c.textContent = label;
    $('chips').appendChild(c);
  }
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
    let v = el.type === 'checkbox' ? el.checked : +el.value;
    if (el.dataset.min) v = Math.max(+el.dataset.min, v);
    current[key] = v;
    save(key, v);
    render();
  });
});

function toggleSection(btn, panel) {
  btn.onclick = () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
    if (btn.id === 'moreBtn') btn.firstElementChild.textContent = panel.hidden ? 'More options' : 'Less options';
  };
}
toggleSection($('moreBtn'), $('more'));
toggleSection($('silenceBtn'), $('silence'));

// ---------- Plataformas ----------
let activePlatformId = null;

const PLATFORM_UI = {
  meet: { icon: 'video', color: 'green' },
  teams: { icon: 'users', color: 'violet' },
  zoom: { icon: 'video', color: 'blue' }
};

function renderPlatforms() {
  $('platforms').innerHTML = '';
  for (const p of PLATFORMS) {
    const ui = PLATFORM_UI[p.id] || { icon: 'globe', color: 'gray' };
    const live = p.id === activePlatformId;
    const row = document.createElement('label');
    row.className = 'row plat';
    row.innerHTML = `<span class="tile rel ${ui.color}"><svg class="ico"><use href="#i-${ui.icon}"/></svg><i class="dot"></i></span><span class="txt"><b></b><small></small></span><input type="checkbox" class="switch">`;
    row.querySelector('.dot').classList.toggle('live', live);
    row.querySelector('b').textContent = p.name;
    row.querySelector('small').textContent = live ? 'Active in this tab' : new URL(p.urlPrefix).hostname;
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
  if (mic === null) [text, cls] = ['Join a call', 'chip none'];
  else if (!mic) [text, cls] = ['Unmute to test', 'chip none'];
  else if (level > current.threshold) [text, cls] = ['Voice detected', 'chip ok-chip'];
  else [text, cls] = ['Silence', 'chip'];
  document.querySelectorAll('.testBadge').forEach((b) => { b.textContent = text; b.className = `testBadge ${cls}`; });
}


async function poll() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = tab?.url ? platformForUrl(tab.url) : null;
  if ((platform?.id ?? null) !== activePlatformId) { activePlatformId = platform?.id ?? null; renderPlatforms(); }
  if (!platform) {
    setSt('stSilent', '—'); setLevel(0, null);
    setSt('stSite', '—'); setSt('stMic', '—'); setSt('stCam', '—');
    return;
  }
  setSt('stSite', new URL(tab.url).hostname);
  chrome.tabs.sendMessage(tab.id, { type: 'status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      setSt('stSilent', 'Reload the tab'); setLevel(0, null);
      setSt('stMic', '—'); setSt('stCam', '—');
      return;
    }
    setSt('stMic', res.mic === null ? '—' : res.mic ? 'Live' : 'Muted', res.mic === null ? '' : res.mic ? 'bad' : 'info');
    setSt('stCam', res.cam === null ? '—' : res.cam ? 'On' : 'Off', res.cam === null ? '' : res.cam ? 'bad' : 'info');
    setLevel(res.level, res.mic);
    setSt('stSilent', res.mic ? `${res.silentFor}s` : '—');
  });
}
setInterval(poll, 150);
poll();
