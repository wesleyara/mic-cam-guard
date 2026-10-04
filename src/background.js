// Notificação nativa quando a aba do Meet não está visível
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'notify') return;
  chrome.notifications.create(`mmg-${sender.tab?.id ?? 0}`, {
    type: 'basic',
    iconUrl: 'src/icon128.png',
    title: msg.autoMuted ? 'Microfone mutado' : 'Microfone ligado',
    message: msg.autoMuted
      ? `Mutado automaticamente após ${msg.seconds}s de silêncio.`
      : `Você não fala há ${msg.seconds}s. Quer mutar?`,
    priority: 2
  });
});

chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.replace('mmg-', ''));
  if (!tabId) return;
  const tab = await chrome.tabs.update(tabId, { active: true });
  chrome.windows.update(tab.windowId, { focused: true });
  chrome.notifications.clear(id);
});
