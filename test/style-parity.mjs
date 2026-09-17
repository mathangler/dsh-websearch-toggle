/**
 * One-off check: the switch stylesheet must carry every declaration the shipped
 * primitives' Switch.module.css declares, value for value.
 *
 * This is the drift that shipped once — a hand-rolled copy of the switch missed
 * `corner-shape: round`, and the theme's global
 * `*,:before,:after{corner-shape:superellipse(1.5)}` turned the track into a
 * squircle so it no longer matched the other switches on the page.
 *
 * Run:  node test/style-parity.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shippedPath = process.argv[2]
  ?? 'C:/Users/chend/scoop/persist/nvm/nodejs/v24.21.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Switch.module.css';

const shipped = readFileSync(shippedPath, 'utf8');
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
const start = source.indexOf('const CSS = [');
const end = source.indexOf("].join('')", start);
if (start < 0 || end < 0) throw new Error('could not locate the CSS array in lib/client.js');
const mine = source.slice(start, end).replace(/\s+/gu, '');

/** `.switch` and `.thumb` are the only shipped selectors this plugin reproduces. */
const rename = { '.switch': '.dshwst-switch', '.thumb': '.dshwst-thumb' };

const checked = [];
const missing = [];
for (const block of shipped.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
  const selector = block[1].split('*/').pop().trim();
  if (!selector.startsWith('.')) continue;
  for (const raw of block[2].split(';')) {
    const declaration = raw.trim();
    if (declaration === '') continue;
    const mapped = Object.entries(rename).reduce((acc, [from, to]) => acc.split(from).join(to), selector);
    checked.push(`${selector} { ${declaration} }`);
    if (!mine.includes(declaration.replace(/\s+/gu, ''))) missing.push(`${selector} { ${declaration} }`);
    void mapped;
  }
}

console.log(`shipped declarations checked : ${checked.length}`);
console.log(`missing from this plugin     : ${missing.length}`);
for (const entry of missing) console.log(`   MISSING: ${entry}`);
process.exitCode = missing.length === 0 ? 0 : 1;
