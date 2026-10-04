const DEFAULTS = {
  enabled: true,
  threshold: 0.02,
  silenceSeconds: 30,
  repeatSeconds: 20,
  nativeNotification: true,
  autoMute: false,
  autoMuteSeconds: 60,
  muteOnJoin: false,
  cameraOffOnJoin: false,
  confirmUnmute: false,
  confirmCamera: false,
  forceMute: false,
  forceCameraOff: false,
  warnBeforeClose: false,
  mutedTalkWarning: false,
  deviceChangeWarning: false,
  micDeviceId: '',
  platformMeet: true,
  platformTeams: true,
  platformZoom: true,
  // Seletores ainda não validados em chamadas reais: começam desligadas.
  platformWebex: false,
  platformWhereby: false,
  platformSlack: false,
  platformDiscord: false,
  // { [platformId]: { [protectionKey]: boolean } } — sobrescreve as proteções só naquele site
  platformOverrides: {},
  scheduleEnabled: false,
  scheduleStart: '09:00',
  scheduleEnd: '18:00',
  scheduleWeekdays: true,
  scheduleProfile: 'big',
  language: 'auto',
  theme: 'system'
};

// i18n próprio (e não chrome.i18n, que sempre segue o navegador) para o idioma poder ser
// trocado dentro da extensão. MESSAGES vem de src/messages.js, gerado a partir de _locales/.
const LANGUAGES = [['en', 'English'], ['pt_BR', 'Português (Brasil)']];
let uiLang = 'en';
function resolveLanguage(pref) {
  if (pref && pref !== 'auto' && MESSAGES[pref]) return pref;
  const ui = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.())
    || (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return /^pt/i.test(ui) ? 'pt_BR' : 'en';
}
function setLanguage(pref) { uiLang = resolveLanguage(pref); }
// subs: valor ou array, substitui {1}, {2}... Cai no inglês se a chave faltar no idioma.
const t = (key, subs) => {
  const args = subs === undefined ? [] : [].concat(subs);
  return (MESSAGES[uiLang]?.[key] ?? MESSAGES.en[key] ?? key).replace(/\{(\d)\}/g, (_, n) => args[n - 1] ?? '');
};

// Perfis: só mexem nas proteções; limiares, plataformas e tema ficam como estão.
const PROTECTION_KEYS = [
  'autoMute', 'muteOnJoin', 'cameraOffOnJoin', 'confirmUnmute', 'confirmCamera',
  'mutedTalkWarning', 'deviceChangeWarning', 'forceMute', 'forceCameraOff', 'warnBeforeClose'
];
const PRESETS = [
  { id: 'big', label: 'p_profileBig', desc: 'p_profileBigDesc',
    values: { autoMute: true, muteOnJoin: true, cameraOffOnJoin: true, confirmUnmute: true, deviceChangeWarning: true } },
  { id: 'one', label: 'p_profileOne', desc: 'p_profileOneDesc',
    values: { warnBeforeClose: true } },
  { id: 'present', label: 'p_profilePresent', desc: 'p_profilePresentDesc',
    values: { confirmCamera: true, mutedTalkWarning: true, deviceChangeWarning: true, warnBeforeClose: true } },
  { id: 'strict', label: 'p_profileStrict', desc: 'p_profileStrictDesc',
    values: { forceMute: true, forceCameraOff: true } }
];
function presetValues(preset) {
  return Object.fromEntries(PROTECTION_KEYS.map((k) => [k, !!preset.values[k]]));
}
function matchingPreset(cfg) {
  return PRESETS.find((p) => PROTECTION_KEYS.every((k) => !!cfg[k] === !!p.values[k])) || null;
}

// ---------- Agendamento ----------
const toMinutes = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

// Janela [início, fim). Se início > fim, atravessa a meia-noite; o filtro de dias úteis
// vale para o dia em que a janela começou.
function inSchedule(cfg, now = new Date()) {
  if (!cfg.scheduleEnabled) return false;
  const a = toMinutes(cfg.scheduleStart), b = toMinutes(cfg.scheduleEnd);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const overnight = a > b;
  const inside = overnight ? cur >= a || cur < b : cur >= a && cur < b;
  if (!inside) return false;
  const startDay = overnight && cur < b ? (now.getDay() + 6) % 7 : now.getDay();
  return !(cfg.scheduleWeekdays && (startDay === 0 || startDay === 6));
}

// Config efetiva de uma plataforma: base → perfil do horário (só liga, nunca desliga)
// → regras específicas do site (as mais específicas vencem).
function effectiveConfig(raw, platformId, now = new Date()) {
  const cfg = { ...DEFAULTS, ...raw };
  if (inSchedule(cfg, now)) {
    const preset = PRESETS.find((p) => p.id === cfg.scheduleProfile);
    if (preset) for (const [k, v] of Object.entries(preset.values)) if (v) cfg[k] = true;
  }
  return { ...cfg, ...(cfg.platformOverrides?.[platformId] || {}) };
}

// Valida um JSON importado: só chaves conhecidas, com o tipo certo.
function sanitizeSettings(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (k === 'micDeviceId' || !(k in obj)) continue; // IDs de dispositivo são da máquina
    const v = obj[k];
    if (k === 'platformOverrides') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      out[k] = {};
      for (const [pid, vals] of Object.entries(v)) {
        if (!vals || typeof vals !== 'object') continue;
        out[k][pid] = Object.fromEntries(PROTECTION_KEYS.filter((pk) => typeof vals[pk] === 'boolean').map((pk) => [pk, vals[pk]]));
      }
      continue;
    }
    if (typeof v !== typeof def) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (k === 'theme' && !['light', 'dark', 'system'].includes(v)) continue;
    if (k === 'language' && v !== 'auto' && !LANGUAGES.some(([id]) => id === v)) continue;
    if ((k === 'scheduleStart' || k === 'scheduleEnd') && !TIME.test(v)) continue;
    if (k === 'scheduleProfile' && !PRESETS.some((p) => p.id === v)) continue;
    out[k] = v;
  }
  return out;
}
