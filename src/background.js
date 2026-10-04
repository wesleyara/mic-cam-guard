importScripts("messages.js", "defaults.js");
// Notificação nativa quando a aba da reunião não está visível
const NOTIFY = {
  autoMuted: (m) => [t('n_micMuted'), t('n_autoMutedMsg', m.seconds)],
  mutedTalk: () => [t('n_mutedTalkTitle'), t('n_mutedTalkMsg')],
  deviceLost: () => [t('n_deviceLostTitle'), t('n_deviceLostMsg')],
  silent: (m) => [t('n_micLive'), t('n_silentMsg', m.seconds)]
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'testNotify') { testNotify().then(reply); return true; } // resposta assíncrona
  if (msg.type === 'notify') notify(msg, sender);
  else if (msg.type === 'panicAll') panic();
  else if (msg.type === 'stat') bump(msg.name);
});

async function notify(msg, sender) {
  const { language } = await chrome.storage.sync.get({ language: DEFAULTS.language });
  setLanguage(language);
  const [title, message] = (NOTIFY[msg.kind] || NOTIFY.silent)(msg);
  try {
    await chrome.notifications.create(`mmg-${sender.tab?.id ?? 0}`, {
      type: 'basic', iconUrl: 'src/icon128.png', title, message, priority: 2
    });
  } catch (e) {
    console.error('[MicCam Guard] notificação falhou:', e);
  }
}

// Botão "Enviar notificação de teste" (Ajustes): separa problema do sistema de problema do gatilho.
async function testNotify() {
  const { language } = await chrome.storage.sync.get({ language: DEFAULTS.language });
  setLanguage(language);
  let level = 'unknown';
  try { level = await chrome.notifications.getPermissionLevel(); } catch { /* API indisponível */ }
  if (level === 'denied') return { ok: false, level };
  try {
    await chrome.notifications.create('mmg-test', {
      type: 'basic', iconUrl: 'src/icon128.png', title: t('n_testTitle'), message: t('n_testMsg'), priority: 2
    });
    return { ok: true, level };
  } catch (e) {
    console.error('[MicCam Guard] notificação de teste falhou:', e);
    return { ok: false, level, error: String(e?.message || e) };
  }
}

// Contador local de proteções (nunca sai do navegador). Fila para não perder
// incrementos simultâneos de várias abas.
const STAT_NAMES = ['autoMutes', 'blocked', 'mutedTalk', 'panic'];
let statQueue = Promise.resolve();
function bump(name) {
  if (!STAT_NAMES.includes(name)) return;
  statQueue = statQueue.then(async () => {
    const { stats = {} } = await chrome.storage.local.get('stats');
    stats[name] = (stats[name] || 0) + 1;
    stats.since ||= Date.now();
    await chrome.storage.local.set({ stats });
  }).catch(() => {});
}

// Pânico: muta o microfone e desliga a câmera em todas as abas de reunião.
async function panic() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getManifest().host_permissions });
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'panic' }).catch(() => {});
}

chrome.commands.onCommand.addListener((cmd) => { if (cmd === 'panic') panic(); });

chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.replace('mmg-', ''));
  if (!tabId) return;
  const tab = await chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
  chrome.notifications.clear(id);
});
