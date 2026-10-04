// Rodar com: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Os scripts da extensão são globais de navegador: avalia no mesmo contexto, como o manifest faz.
function load(...files) {
  const ctx = vm.createContext({ chrome: { i18n: { getUILanguage: () => 'pt-BR' } }, URL, document: { querySelectorAll: () => [] } });
  const code = files.map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  return vm.runInContext(`${code}\n({ MESSAGES, t, setLanguage, resolveLanguage, LANGUAGES, DEFAULTS, PRESETS, PROTECTION_KEYS, presetValues, matchingPreset, inSchedule, effectiveConfig, sanitizeSettings, ${files.includes('platforms.js') ? 'platformForUrl, PLATFORMS' : ''} })`, ctx);
}
const lib = load('messages.js', 'defaults.js', 'platforms.js');
// 2026-10-05 é segunda; 2026-10-04 é domingo.
const at = (iso) => new Date(iso);

test('presets: cada perfil é reconhecido e nenhum se confunde com outro', () => {
  for (const p of lib.PRESETS) assert.strictEqual(lib.matchingPreset(lib.presetValues(p)).id, p.id);
  assert.strictEqual(lib.matchingPreset({ ...lib.DEFAULTS, autoMute: true }), null);
});

test('agendamento: janela normal, fim exclusivo e dias úteis', () => {
  const cfg = { scheduleEnabled: true, scheduleStart: '09:00', scheduleEnd: '18:00', scheduleWeekdays: true };
  assert.ok(lib.inSchedule(cfg, at('2026-10-05T09:00:00')));
  assert.ok(!lib.inSchedule(cfg, at('2026-10-05T08:59:00')));
  assert.ok(!lib.inSchedule(cfg, at('2026-10-05T18:00:00')));
  assert.ok(!lib.inSchedule(cfg, at('2026-10-04T10:00:00')), 'domingo fica fora');
  assert.ok(lib.inSchedule({ ...cfg, scheduleWeekdays: false }, at('2026-10-04T10:00:00')));
  assert.ok(!lib.inSchedule({ ...cfg, scheduleEnabled: false }, at('2026-10-05T10:00:00')));
});

test('agendamento: janela que atravessa a meia-noite', () => {
  const cfg = { scheduleEnabled: true, scheduleStart: '22:00', scheduleEnd: '06:00', scheduleWeekdays: true };
  assert.ok(lib.inSchedule(cfg, at('2026-10-05T23:00:00')));  // seg à noite
  assert.ok(lib.inSchedule(cfg, at('2026-10-06T05:00:00')));  // ter de madrugada (janela de seg)
  assert.ok(!lib.inSchedule(cfg, at('2026-10-04T23:00:00')), 'dom à noite');
  assert.ok(!lib.inSchedule(cfg, at('2026-10-05T05:00:00')), 'seg de madrugada pertence à janela de dom');
  assert.ok(!lib.inSchedule({ ...cfg, scheduleStart: '10:00', scheduleEnd: '10:00' }, at('2026-10-05T10:00:00')), 'janela vazia');
  assert.ok(!lib.inSchedule({ ...cfg, scheduleStart: 'xx' }, at('2026-10-05T23:00:00')), 'horário inválido');
});

test('config efetiva: horário só liga proteções; regra do site vence', () => {
  const raw = { scheduleEnabled: true, scheduleStart: '09:00', scheduleEnd: '18:00', scheduleProfile: 'strict', autoMute: true };
  const inside = at('2026-10-05T10:00:00');
  const c = lib.effectiveConfig(raw, 'meet', inside);
  assert.ok(c.forceMute && c.forceCameraOff, 'perfil do horário ligou o force');
  assert.ok(c.autoMute, 'não desliga o que já estava ligado');
  const o = lib.effectiveConfig({ ...raw, platformOverrides: { teams: { forceMute: false } } }, 'teams', inside);
  assert.strictEqual(o.forceMute, false, 'override do Teams vence o horário');
  assert.ok(lib.effectiveConfig({ ...raw, platformOverrides: { teams: { forceMute: false } } }, 'meet', inside).forceMute, 'outros sites não mudam');
  assert.ok(!lib.effectiveConfig(raw, 'meet', at('2026-10-05T20:00:00')).forceMute, 'fora da janela');
});

test('importação: descarta chaves/tipos inválidos e IDs de dispositivo', () => {
  const clean = lib.sanitizeSettings({
    autoMute: true, threshold: 'alto', theme: 'neon', scheduleStart: '9h', scheduleProfile: 'nope',
    micDeviceId: 'abc', hacker: 1, silenceSeconds: Infinity,
    platformOverrides: { meet: { forceMute: true, evil: true, autoMute: 'x' }, bad: 5 }
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(clean)), { autoMute: true, platformOverrides: { meet: { forceMute: true } } });
  assert.deepStrictEqual(Object.keys(lib.sanitizeSettings([1, 2])), []);
  assert.deepStrictEqual(Object.keys(lib.sanitizeSettings(null)), []);
});

test('plataformas: roteamento por URL', () => {
  const id = (u) => lib.platformForUrl(u)?.id ?? null;
  assert.strictEqual(id('https://meet.google.com/abc-defg-hij'), 'meet');
  assert.strictEqual(id('https://teams.microsoft.com/v2/'), 'teams');
  assert.strictEqual(id('https://app.zoom.us/wc/123/join'), 'zoom');
  assert.strictEqual(id('https://zoom.us/pricing'), null, 'zoom só em /wc/');
  assert.strictEqual(id('https://company.webex.com/meet/x'), 'webex');
  assert.strictEqual(id('https://whereby.com/room'), 'whereby');
  assert.strictEqual(id('https://app.slack.com/client/T1/C1'), 'slack');
  assert.strictEqual(id('https://slack.com/intl/pt-br'), null);
  assert.strictEqual(id('https://discord.com/channels/1/2'), 'discord');
  assert.strictEqual(id('https://discord.com/login'), null);
  assert.strictEqual(id('https://evil.com/?u=meet.google.com'), null);
});

test('toda plataforma tem chave de config e está no manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  for (const p of lib.PLATFORMS) {
    assert.ok(p.settingKey in lib.DEFAULTS, `${p.id}: ${p.settingKey} ausente em DEFAULTS`);
    assert.ok(manifest.content_scripts[0].matches.some((m) => new RegExp('^' + m.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$').test(p.urlPrefix)), `${p.id} fora do manifest`);
    for (const f of ['findMic', 'findCam', 'isOn', 'inCall', 'micKey', 'camKey']) assert.strictEqual(typeof p[f], 'function', `${p.id}.${f}`);
  }
});

test('i18n: toda chave usada existe em en e pt_BR', () => {
  const src = ['content.js', 'background.js', 'popup.js', 'popup.html', 'defaults.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n')
    + fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');
  // Qualquer literal de string com prefixo de chave (cobre ternários, arrays e data-i18n).
  const keys = new Set([...src.matchAll(/['"]((?:[cnp]_|ext|cmd)[A-Za-z0-9]+)['"]/g)].map((m) => m[1]));
  for (const m of src.matchAll(/__MSG_(\w+)__/g)) keys.add(m[1]);
  for (const loc of ['en', 'pt_BR']) {
    const msgs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', loc, 'messages.json'), 'utf8'));
    const missing = [...keys].filter((k) => !(k in msgs));
    assert.deepStrictEqual(missing, [], `${loc} sem: ${missing}`);
  }
});

test('i18n: src/messages.js está em sincronia com _locales (rode tools/build-messages.js)', () => {
  const onDisk = fs.readFileSync(path.join(__dirname, '..', 'src', 'messages.js'), 'utf8');
  assert.strictEqual(onDisk, require('../tools/build-messages.js').build());
});

test('i18n: os idiomas têm exatamente as mesmas chaves e os mesmos placeholders', () => {
  const [en, pt] = [lib.MESSAGES.en, lib.MESSAGES.pt_BR];
  assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(pt).sort());
  const ph = (m) => (m.match(/\{\d\}/g) || []).sort().join();
  for (const k of Object.keys(en)) assert.strictEqual(ph(en[k]), ph(pt[k]), `placeholders de ${k}`);
});

test('idioma: auto segue o navegador, escolha explícita vence, {n} é substituído', () => {
  assert.strictEqual(lib.resolveLanguage('auto'), 'pt_BR');   // stub: navegador em pt-BR
  assert.strictEqual(lib.resolveLanguage('en'), 'en');
  assert.strictEqual(lib.resolveLanguage('xx'), 'pt_BR');     // desconhecido cai no auto
  lib.setLanguage('en');
  assert.strictEqual(lib.t('c_silentFor', 7), "You haven't spoken for 7s");
  lib.setLanguage('pt_BR');
  assert.strictEqual(lib.t('c_silentFor', 7), 'Você não fala há 7s');
  assert.strictEqual(lib.t('c_silentAuto', [7, 3]), 'Você não fala há 7s · auto-mute em 3s');
  assert.strictEqual(lib.t('chave_inexistente'), 'chave_inexistente');
});

test('importação: aceita só idiomas conhecidos', () => {
  assert.strictEqual(lib.sanitizeSettings({ language: 'en' }).language, 'en');
  assert.strictEqual(lib.sanitizeSettings({ language: 'auto' }).language, 'auto');
  assert.strictEqual(lib.sanitizeSettings({ language: 'klingon' }).language, undefined);
});
