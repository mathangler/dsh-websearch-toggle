/**
 * Locate the DSH installation's bundled `@deepseek-ai` packages, portably.
 *
 * Two checks need the packages a running Harness was built from — comparing this
 * plugin's stylesheet against the shipped `Switch.module.css`, and proving every
 * service the client half injects is really registered. Both used to hardcode one
 * developer's Windows path, which made the two most valuable checks in this repo
 * unusable anywhere else.
 *
 * Resolution order, first hit that validates wins:
 *
 *   1. an explicit argument (or `$DSH_BUNDLED_PACKAGES`);
 *   2. walking up from the running `node` binary — nvm, volta, fnm and a
 *      Homebrew/Linuxbrew node all keep a `node_modules` beside the binary;
 *   3. walking up from the working directory, which covers the case of running
 *      these checks from a DSH source checkout;
 *   4. the global npm root, for a `npm i -g @deepseek-ai/dsh` install.
 *
 * @module dsh-websearch-toggle/test/dsh-install
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Packages that must exist inside a real bundled root, used to validate a guess. */
const WITNESSES = ['dsh-settings', 'dsh-client-ui-primitives', 'dsh-client-ui-settings'];

/** Does this directory look like an installed `@deepseek-ai` package folder? */
function looksRight(dir) {
  return WITNESSES.some((witness) => existsSync(join(dir, witness, 'package.json')));
}

/** Candidate `@deepseek-ai` roots, most specific first. */
function candidates() {
  const roots = [];
  const walk = (start) => {
    let dir = start;
    for (let depth = 0; depth < 7; depth += 1) {
      roots.push(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'));
      roots.push(join(dir, 'node_modules', '@deepseek-ai'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  };
  walk(dirname(process.execPath));
  walk(process.cwd());

  try {
    // One command string rather than args + `shell`, which Node deprecates
    // (DEP0190) and which would be an injection surface.
    const globalRoot = execFileSync('npm root -g', { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (globalRoot.length > 0) roots.push(join(globalRoot, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'));
  } catch {
    // npm may be absent, or a confined sandbox may refuse the spawn; the
    // filesystem probes above are the primary path.
  }
  return roots;
}

/**
 * Find the bundled `@deepseek-ai` package directory.
 *
 * An explicitly given path is AUTHORITATIVE: if it does not validate this throws
 * rather than quietly checking a different installation, which is what an
 * override is for.
 *
 * @param explicit - optional directory to use instead of searching.
 * @returns the absolute directory holding the bundled packages.
 * @throws {Error} when nothing validates, naming how to pass one explicitly.
 */
export function findBundledPackages(explicit) {
  const given = explicit ?? process.env.DSH_BUNDLED_PACKAGES;
  if (typeof given === 'string' && given.length > 0) {
    if (looksRight(given)) return given;
    throw new Error(`${given} does not look like an installed @deepseek-ai package directory (looked for ${WITNESSES.join(', ')})`);
  }
  for (const root of candidates()) {
    if (looksRight(root)) return root;
  }
  throw new Error(
    'cannot locate the installed @deepseek-ai packages.\n' +
      'Pass the directory as an argument, or set DSH_BUNDLED_PACKAGES, e.g.\n' +
      '  node test/service-contract.mjs /path/to/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  );
}

/**
 * Find one bundled package's directory.
 *
 * @param packageName - a package inside the bundled root, e.g. `dsh-client-ui-primitives`.
 * @param explicit - optional root to try first.
 * @returns the absolute package directory.
 * @throws {Error} when the package is not present in the resolved root.
 */
export function findBundledPackage(packageName, explicit) {
  const root = findBundledPackages(explicit);
  const dir = join(root, packageName);
  if (!existsSync(join(dir, 'package.json'))) throw new Error(`${packageName} is not installed under ${root}`);
  return dir;
}
