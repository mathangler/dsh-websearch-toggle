/**
 * Client-service contract check.
 *
 * The client half declares `exports.inject = [...]`, a list of Cordis SERVICE
 * names its plugin waits for before it applies. If a name does not exist, the
 * plugin's fiber waits forever and the page reports the plugin as broken — the
 * whole point of the list is that it can only name services that are really
 * registered.
 *
 * DSH 0.1.7 removed `settingsScope` and replaced it with `configForms`. Nothing
 * in this repository failed: the tests stubbed the service, the host half booted
 * clean, and the bundle was served with HTTP 200. Only the running browser
 * noticed. So this check reads the INSTALLED packages and asserts that every
 * service the bundle injects is actually registered by one of them.
 *
 * Run:  node test/service-contract.mjs [rootDir]
 * The root is located portably (see ./dsh-install.mjs); pass one explicitly or
 * set DSH_BUNDLED_PACKAGES when the automatic search cannot find it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBundledPackages } from './dsh-install.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8');

const packageRoot = findBundledPackages(process.argv[2]);

/** The service names the bundle declares it needs. */
const declared = (/const inject = \[([^\]]*)\]/u.exec(source)?.[1] ?? '')
  .split(',')
  .map((entry) => entry.trim().replace(/^['"]|['"]$/gu, ''))
  .filter(Boolean);

if (declared.length === 0) throw new Error('could not read `const inject` from lib/client.js');

/** Every `.js` file under a directory. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...jsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && statSync(full).size < 8_000_000) {
      out.push(full);
    }
  }
  return out;
}

/** Every service name any installed client package registers. */
function registeredServices() {
  const found = new Map();
  let packages = [];
  try {
    packages = readdirSync(packageRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(packageRoot, entry.name));
  } catch {
    throw new Error(`cannot read the dsh installation at ${packageRoot} — pass the @deepseek-ai directory as argv[2]`);
  }
  // Two registration forms are in use: `super(ctx, "name")` for a Service
  // subclass, and `ctx.provide("name", value)` for a plain object. The locale
  // service uses the second, so scanning only the first reports a false missing.
  const patterns = [
    /super\(ctx,\s*"([A-Za-z][\w$]*)"\)/gu,
    /ctx\.provide\(\s*"([A-Za-z][\w$]*)"/gu,
    /ctx\.provide\(\s*'([A-Za-z][\w$]*)'/gu,
  ];
  for (const pkg of packages) {
    for (const file of jsFiles(pkg)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          if (!found.has(match[1])) found.set(match[1], file.slice(packageRoot.length + 1));
        }
      }
    }
  }
  return found;
}

const services = registeredServices();
const missing = declared.filter((name) => !services.has(name));

console.log(`services declared by this plugin : ${declared.join(', ')}`);
console.log(`services registered in this install: ${services.size}`);
for (const name of declared) {
  const where = services.get(name);
  console.log(`  ${where === undefined ? 'MISSING' : 'ok     '}  ${name}${where === undefined ? '' : `  <- ${where}`}`);
}
if (missing.length > 0) {
  console.log(`\nFAIL: ${missing.join(', ')} not registered by any installed client package.`);
  console.log('An inject that names a missing service leaves the plugin fiber waiting forever,');
  console.log('and the Web UI then reports this plugin as broken.');
}
process.exitCode = missing.length === 0 ? 0 : 1;
