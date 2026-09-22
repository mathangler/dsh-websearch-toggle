/**
 * Dependency-floor check for `@deepseek-ai/schemastery`.
 *
 * This exists because of a shipped failure that nothing else caught. The plugin
 * declared `^3.18.2`, and npm's `latest` tag for that package is **3.18.2** —
 * which does NOT have `.volatile()`, the API the Config schema depends on. So
 * `pnpm` resolved the range to a version without it, and the Host Loader reported
 * the row as `failed to import`:
 *
 *   websearch-toggle (dsh-websearch-toggle): failed to import
 *   ... z.boolean(...).default(...).volatile is not a function
 *
 * Three things made that invisible until a real install:
 *
 *   - `.volatile()` is required, not cosmetic: `SettingsForms.describe()` keeps a
 *     namespace only if `volatileForm(schema)` returns a schema, and that keeps
 *     only fields carrying `meta.volatile`;
 *   - a `link:` dev install resolved the PLATFORM's bundled schemastery (3.18.3)
 *     instead of the declared dependency, so every dev-side check passed;
 *   - 3.18.3 is published but is not the `latest` tag, so `^3.18.2` cannot reach it.
 *
 * The floor is therefore load-bearing, and this asserts two things: that the
 * declared range's floor is at least the version that introduced `.volatile()`,
 * and that the copy resolvable from here really exposes it.
 *
 * Run:  node test/dependency-floor.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The first published version whose schemastery has `.volatile()`. */
const FIRST_WITH_VOLATILE = [3, 18, 3];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declared = manifest.dependencies?.['@deepseek-ai/schemastery'];

if (typeof declared !== 'string') {
  throw new Error('package.json must declare a @deepseek-ai/schemastery dependency');
}

/** Parse the floor of a caret/tilde/exact range into `[major, minor, patch]`. */
function floorOf(range) {
  const match = /[\^~]?\s*(\d+)\.(\d+)\.(\d+)/u.exec(range);
  if (match === null) throw new Error(`cannot read a floor version out of "${range}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two `[major, minor, patch]` triples. */
function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

const floor = floorOf(declared);
const floorText = floor.join('.');
const neededText = FIRST_WITH_VOLATILE.join('.');

console.log(`declared range        : ${declared}`);
console.log(`its floor             : ${floorText}`);
console.log(`needs at least        : ${neededText} (first version with .volatile())`);

let failed = compare(floor, FIRST_WITH_VOLATILE) < 0;
if (failed) {
  console.log(`\nFAIL: ${floorText} has no .volatile(), so the Config schema throws at import time`);
  console.log('and the Host Loader reports the row as "failed to import".');
}

// The copy this package actually resolves must expose the API too. A missing
// install is a loud failure rather than a skip: this check is only meaningful
// when the dependency is installed, which is exactly how it runs in CI and after
// `dsh plugin add`.
const require = createRequire(import.meta.url);
let resolvedPath = null;
try {
  resolvedPath = require.resolve('@deepseek-ai/schemastery/package.json');
} catch {
  console.log('\nFAIL: @deepseek-ai/schemastery is not installed here — run npm install first.');
  process.exitCode = 1;
}

if (resolvedPath !== null) {
  const installed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  const version = installed.version;
  console.log(`resolved copy         : ${version}  (${resolvedPath})`);
  if (compare(floorOf(version), FIRST_WITH_VOLATILE) < 0) {
    console.log(`\nFAIL: the resolved copy is ${version}, which has no .volatile().`);
    failed = true;
  }
  if (JSON.stringify(floorOf(version)) !== JSON.stringify(floor)) {
    console.log('note: the resolved copy is not the floor of the range; the floor is what a fresh install may pick.');
  }
}

if (!failed) console.log('\nok: the declared floor and the resolved copy both expose .volatile().');
process.exitCode = failed ? 1 : 0;
