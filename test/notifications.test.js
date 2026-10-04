// Rodar com: node --test test/notifications.test.js
// Valida a cadeia do auto-mute: content.js decide e envia → background.js monta a notificação nativa.
// Roda o código real da extensão em vm, com stubs mínimos de chrome/DOM/áudio.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

// ---------- content script ----------
// opts: hidden (aba em segundo plano), cfg (config salva), responds (o botão do Meet reage ao clique)
async function runContent({ hidden = true, cfg = {}, responds = true, seconds = 15, stale = false } = {}) {
  let now = 1_700_000_000_000;
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(now); }
    static now() { return now; }
  }
  const sent = [], appended = [];
  const mic = {
    clicks: 0, muted: false,
    getAttribute(n) { return { 'aria-label': 'Desativar microfone', 'data-is-muted': String(this.muted) }[n] ?? null; },
    click() { this.clicks++; if (responds) this.muted = !this.muted; },
    contains: () => false
  };
  const fakeEl = () => ({
    style: {}, classList: { add() {}, remove() {} }, offsetWidth: 0, textContent: '', title: '',
    querySelector: fakeEl, setAttribute() {}, appendChild() {}, remove() {}, focus() {}
  });
  const loops = [];
  const ctx = vm.createContext({
    Date: FakeDate, console, Promise, Float32Array, URL,
    setInterval: (fn) => { loops.push(fn); return loops.length; },
    setTimeout: () => 0,
    location: { href: 'https://meet.google.com/abc-defg-hij' },
    window: { addEventListener() {} },
    navigator: { language: 'en-US', mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [] }),
      enumerateDevices: async () => [], addEventListener() {} } },
    AudioContext: class {
      createMediaStreamSource() { return { connect: (n) => n }; }
      createBiquadFilter() { return { frequency: {}, Q: {}, connect: (n) => n }; }
      createAnalyser() { return { getFloatTimeDomainData() {} /* só zeros = silêncio */ }; }
      close() { return Promise.resolve(); }
    },
    document: {
      hidden,
      body: { appendChild: (e) => appended.push(e) },
      createElement: fakeEl, getElementById: () => null,
      querySelectorAll: () => [mic], addEventListener() {}
    },
    chrome: {
      i18n: { getUILanguage: () => 'en-US' },
      // stale: a extensão foi recarregada e este script ficou órfão (runtime.id some, sendMessage lança)
      runtime: stale
        ? { sendMessage() { throw new Error('Extension context invalidated.'); }, onMessage: { addListener() {} } }
        : { id: 'abc', sendMessage: (m) => { sent.push(m); return Promise.resolve(); }, onMessage: { addListener() {} } },
      storage: {
        onChanged: { addListener() {} },
        sync: { get: (d, cb) => cb({ ...d, autoMute: true, autoMuteSeconds: 10, language: 'en', ...cfg }) }
      }
    }
  });
  for (const f of ['messages.js', 'defaults.js', 'platforms.js', 'content.js']) vm.runInContext(read(f), ctx);
  assert.strictEqual(loops.length, 1, 'content.js registra um único loop');
  // Deixa o loop rodar por `seconds` segundos de silêncio (passos de 200 ms, como em produção)
  for (let i = 0; i < seconds * 5; i++) { now += 200; await loops[0](); }
  return { mic, notifies: sent.filter((m) => m.type === 'notify'), stats: sent.filter((m) => m.type === 'stat'), toasts: appended.map((e) => e.textContent) };
}

test('auto-mute com a aba em segundo plano: muta uma vez e pede 1 notificação nativa', async () => {
  const r = await runContent({ hidden: true });
  assert.strictEqual(r.mic.clicks, 1, 'um clique no botão de mic');
  assert.strictEqual(r.notifies.length, 1);
  assert.strictEqual(r.notifies[0].kind, 'autoMuted');
  assert.ok(r.notifies[0].seconds >= 10 && r.notifies[0].seconds <= 11, `segundos de silêncio: ${r.notifies[0].seconds}`);
  assert.deepStrictEqual(r.stats.map((s) => s.name), ['autoMutes']);
});

test('auto-mute com a aba visível: muta, mas não manda notificação nativa', async () => {
  const r = await runContent({ hidden: false });
  assert.strictEqual(r.mic.clicks, 1);
  assert.strictEqual(r.notifies.length, 0);
});

test('nativeNotification desligado: muta, mas não notifica', async () => {
  const r = await runContent({ hidden: true, cfg: { nativeNotification: false } });
  assert.strictEqual(r.mic.clicks, 1);
  assert.strictEqual(r.notifies.length, 0);
});

test('antes do tempo de silêncio não muta nem notifica', async () => {
  const r = await runContent({ hidden: true, seconds: 8 });
  assert.strictEqual(r.mic.clicks, 0);
  assert.strictEqual(r.notifies.length, 0);
});

test('se o botão demora a refletir o clique, não clica de novo (desmutaria o mic)', async () => {
  // O Meet pode levar mais de 200 ms para atualizar data-is-muted; nesse intervalo o loop
  // não pode repetir o auto-mute, senão o 2º clique religa o microfone e a notificação se repete.
  const r = await runContent({ hidden: true, responds: false, seconds: 14 }); // 10 s até o auto-mute + 4 s dentro da trava
  assert.strictEqual(r.mic.clicks, 1, `cliques com botão que não responde: ${r.mic.clicks}`);
  assert.strictEqual(r.notifies.length, 1, `notificações: ${r.notifies.length}`);
});

test('content script órfão (extensão recarregada): não lança erro e avisa uma vez para recarregar a aba', async () => {
  const r = await runContent({ hidden: true, stale: true, seconds: 15 });
  assert.strictEqual(r.mic.clicks, 0, 'órfão não age');
  assert.deepStrictEqual(r.toasts, ['MicCam Guard was updated. Reload this tab to keep it working.']);
});

// ---------- service worker ----------
function loadBackground(language = 'en', { level = 'granted', createError = null } = {}) {
  const created = [], calls = [], listeners = {};
  const store = {};
  const ctx = vm.createContext({
    console, Promise, URL, Date,
    importScripts: (...files) => files.forEach((f) => vm.runInContext(read(f), ctx)),
    chrome: {
      i18n: { getUILanguage: () => 'en-US' },
      runtime: {
        onMessage: { addListener: (fn) => (listeners.message = fn) },
        getManifest: () => ({ host_permissions: [] })
      },
      commands: { onCommand: { addListener() {} } },
      notifications: {
        getPermissionLevel: async () => level,
        create: async (id, opts) => { if (createError) throw new Error(createError); created.push({ id, ...opts }); },
        clear: (id) => calls.push(['clear', id]),
        onClicked: { addListener: (fn) => (listeners.click = fn) }
      },
      tabs: { update: async (id, p) => { calls.push(['tabs.update', id, p]); return { windowId: 99 }; }, query: async () => [] },
      windows: { update: (id, p) => calls.push(['windows.update', id, p]) },
      storage: {
        sync: { get: async (d) => ({ ...d, language }) },
        local: { get: async () => ({ stats: store.stats }), set: async (o) => Object.assign(store, o) }
      }
    }
  });
  vm.runInContext(read('background.js'), ctx);
  return { created, calls, listeners, store };
}

test('background: notificação do auto-mute em inglês', async () => {
  const bg = loadBackground('en');
  bg.listeners.message({ type: 'notify', kind: 'autoMuted', seconds: 62 }, { tab: { id: 7 } });
  await tick();
  assert.strictEqual(bg.created.length, 1);
  const n = bg.created[0];
  assert.deepStrictEqual([n.id, n.type, n.iconUrl, n.priority], ['mmg-7', 'basic', 'src/icon128.png', 2]);
  assert.strictEqual(n.title, 'Microphone muted');
  assert.strictEqual(n.message, 'Auto-muted after 62s of silence.');
});

test('background: notificação do auto-mute em português (idioma escolhido na extensão)', async () => {
  const bg = loadBackground('pt_BR');
  bg.listeners.message({ type: 'notify', kind: 'autoMuted', seconds: 62 }, { tab: { id: 7 } });
  await tick();
  assert.strictEqual(bg.created[0].title, 'Microfone mutado');
  assert.strictEqual(bg.created[0].message, 'Mutado automaticamente após 62s de silêncio.');
});

test('background: aviso de silêncio e kind desconhecido não derrubam o service worker', async () => {
  const bg = loadBackground('en');
  bg.listeners.message({ type: 'notify', kind: 'silent', seconds: 40 }, { tab: { id: 3 } });
  bg.listeners.message({ type: 'notify', seconds: 40 }, { tab: { id: 3 } });
  bg.listeners.message({ type: 'notify', kind: 'inexistente', seconds: 40 }, { tab: { id: 3 } });
  await tick();
  assert.strictEqual(bg.created.length, 3, 'as 3 geram notificação (a última cai no aviso de silêncio)');
  assert.strictEqual(bg.created[0].message, "You haven't spoken for 40s. Mute?");
});

test('background: clicar na notificação foca a aba e a janela e limpa a notificação', async () => {
  const bg = loadBackground('en');
  await bg.listeners.click('mmg-7');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(bg.calls)), [
    ['tabs.update', 7, { active: true }], ['windows.update', 99, { focused: true }], ['clear', 'mmg-7']
  ]);
  bg.calls.length = 0;
  await bg.listeners.click('mmg-0'); // sem aba associada: ignora
  assert.strictEqual(bg.calls.length, 0);
});

// Chama o listener como o popup faz (sendResponse assíncrono, listener devolve true)
function askTest(bg) {
  return new Promise((resolve) => {
    const keepOpen = bg.listeners.message({ type: 'testNotify' }, {}, resolve);
    assert.strictEqual(keepOpen, true, 'listener precisa devolver true para a resposta assíncrona');
  });
}

test('notificação de teste: cria a notificação e responde ok com o nível de permissão', async () => {
  const bg = loadBackground('pt_BR');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await askTest(bg))), { ok: true, level: 'granted' });
  assert.strictEqual(bg.created[0].id, 'mmg-test');
  assert.strictEqual(bg.created[0].message, 'Notificação de teste: está funcionando!');
});

test('notificação de teste: permissão negada não tenta criar e informa o motivo', async () => {
  const bg = loadBackground('en', { level: 'denied' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await askTest(bg))), { ok: false, level: 'denied' });
  assert.strictEqual(bg.created.length, 0);
});

test('notificação de teste: erro do Chrome volta para o popup em vez de sumir', async () => {
  const bg = loadBackground('en', { createError: 'Unable to download all specified images.' });
  const res = await askTest(bg);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /Unable to download/);
});

test('notificação de teste: clicar nela não tenta focar aba', async () => {
  const bg = loadBackground('en');
  await bg.listeners.click('mmg-test');
  assert.strictEqual(bg.calls.length, 0);
});
