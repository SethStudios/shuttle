/**
 * Export in-app legal text to standalone HTML for public hosting
 * (store listings require a public privacy-policy URL).
 * Source of truth stays in app/terms.tsx + app/privacy.tsx.
 * Run:  node scripts/export-legal.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readConst(name) {
  const src = fs.readFileSync(path.join(root, 'constants', 'app.ts'), 'utf8');
  const m = src.match(new RegExp(name + "\\s*=\\s*'([^']*)'"));
  if (!m) throw new Error('constant not found: ' + name);
  return m[1];
}

const SUPPORT_EMAIL = readConst('SUPPORT_EMAIL');
const LAST_UPDATED = readConst('LAST_UPDATED');

function extractSections(screenFile) {
  const src = fs.readFileSync(path.join(root, 'app', screenFile), 'utf8');
  const body = src.slice(src.indexOf('const SECTIONS'), src.indexOf('];'));
  const re = /h:\s*'([^']*)'\s*,\s*b:\s*(`|'|")([\s\S]*?)\2\s*,?\s*\}/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({
      h: m[1],
      b: m[3].split('${SUPPORT_EMAIL}').join(SUPPORT_EMAIL).split('${LAST_UPDATED}').join(LAST_UPDATED),
    });
  }
  return out;
}

function esc(s) {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
}

function page(title, updated, sections) {
  const blocks = sections
    .map((s) => '    <h2>' + esc(s.h) + '</h2>\n    <p>' + esc(s.b) + '</p>')
    .join('\n');
  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(title) + ' — UniAbuja Shuttle</title>\n' +
    '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:24px 20px 64px;color:#1c1c1e;line-height:1.6}h1{font-size:28px}h2{font-size:19px;margin:28px 0 6px}p{margin:0 0 12px;color:#3c3c43}.meta{color:#6b7280}.foot{margin-top:32px;color:#8e8e93;font-size:13px}</style>\n' +
    '</head>\n<body>\n    <h1>' + esc(title) + '</h1>\n' +
    '    <p class="meta">UniAbuja Shuttle · Last updated ' + esc(updated) + '</p>\n' +
    blocks +
    '\n    <p class="foot">Contact: ' + esc(SUPPORT_EMAIL) + '</p>\n</body>\n</html>\n'
  );
}

const jobs = [
  { screen: 'privacy.tsx', title: 'Privacy Policy', file: 'privacy.html' },
  { screen: 'terms.tsx', title: 'Terms of Service', file: 'terms.html' },
];

fs.mkdirSync(path.join(root, 'legal'), { recursive: true });
for (const j of jobs) {
  const sections = extractSections(j.screen);
  if (sections.length === 0) throw new Error('no sections parsed from ' + j.screen);
  fs.writeFileSync(path.join(root, 'legal', j.file), page(j.title, LAST_UPDATED, sections));
  console.log(j.file + ': ' + sections.length + ' sections');
}
console.log('Support: ' + SUPPORT_EMAIL + ' · Updated: ' + LAST_UPDATED);
