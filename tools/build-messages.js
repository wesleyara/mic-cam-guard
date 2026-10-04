// Gera src/messages.js a partir de _locales/*/messages.json.
// Rodar depois de editar qualquer texto: node tools/build-messages.js
// (o formato {1} dispensa o esquema de placeholders do chrome.i18n; _locales continua
// sendo a fonte da verdade e é o que o manifest usa para nome/descrição/atalho).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const langs = fs.readdirSync(path.join(root, '_locales')).sort();

function convert(entry) {
  return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
    const ph = entry.placeholders?.[name.toUpperCase()];
    return ph ? `{${ph.content.slice(1)}}` : '';
  });
}

const messages = {};
for (const lang of langs) {
  const json = JSON.parse(fs.readFileSync(path.join(root, '_locales', lang, 'messages.json'), 'utf8'));
  messages[lang] = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, convert(v)]));
}

const out = `// GERADO por tools/build-messages.js a partir de _locales/. Não edite à mão.\nconst MESSAGES = ${JSON.stringify(messages, null, 2)};\n`;
if (require.main === module) {
  fs.writeFileSync(path.join(root, 'src', 'messages.js'), out);
  console.log(`src/messages.js: ${langs.join(', ')}`);
}
module.exports = { build: () => out };
