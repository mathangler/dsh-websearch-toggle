/**
 * Host-wiring tests for the host half.
 *
 * The browser OWNS the write: it commits through its settings form, and the Host
 * merely reads the live config accessor. So what these assert is the wiring the
 * browser depends on — the namespace really is the Loader entry id (a namespace
 * this plugin invents cannot be reached by its own browser half), the Config
 * default is the shipped ON, the assembly waterfall withholds the tool, and the
 * guard follows the switch.
 *
 * @module dsh-websearch-toggle/test/wiring
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, inject, name, SETTINGS_NAMESPACE, Config } from '../lib/index.js';
import { WEB_SEARCH_SECTION } from '../lib/host-core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8');

/**
 * Boot the host half against a stub context that models the services it uses.
 * @param options - `enabled` seeds the committed section; `services` limits which
 *   optional services exist, so a deployment missing one is covered too.
 * @returns the captured registrations plus the lever a settings commit pulls.
 */
function boot(options = {}) {
  const have = new Set(options.services === undefined ? ['systemPrompt', 'tools'] : options.services);

  const listeners = [];
  const guards = [];
  const injected = [];
  const effects = [];

  /**
   * The 0.1.7 config plane: `apply(ctx, config)` receives the resolved config and
   * `config.enabled` is a LIVE accessor. A settings write from the browser shows
   * up here as a changed value with no subscription, which is the whole reason
   * this plugin no longer touches a `settings` service.
   */
  let stored = { enabled: options.enabled === undefined ? true : options.enabled };
  const config = { enabled: { get: () => stored.enabled } };

  const ctx = {
    logger: undefined,
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    on(event, listener) {
      listeners.push({ event, listener });
      return () => {};
    },
    get(service) {
      if (!have.has(service)) return undefined;
      return {};
    },
    inject(deps, callback) {
      injected.push(...deps);
      if (!deps.every((dep) => have.has(dep))) return () => {};
      if (deps.includes('systemPrompt')) callback({ on: ctx.on });
      if (deps.includes('tools')) {
        callback({
          tools: {
            guard(guard) {
              guards.push(guard);
              return () => {};
            },
          },
        });
      }
      return () => {};
    },
  };

  apply(ctx, config);

  return {
    ctx,
    config,
    listeners,
    guards,
    injected,
    effects,
    /** Commit a new position the way a settings write from the browser does. */
    commit: async (enabled) => {
      stored = { enabled };
    },
    /** What a settings form would read back. */
    stored: () => stored.enabled,
    listenerFor: (event) => listeners.find((entry) => entry.event === event),
  };
}

/** One assembled prompt shaped like the platform's `PromptAssembly`. */
const assembly = () => ({
  sections: [
    { name: 'persona', text: 'You are a coding agent.' },
    { name: WEB_SEARCH_SECTION, text: 'Use the web_search tool.' },
  ],
  contexts: [],
  tools: [{ name: 'read' }, { name: 'web_search' }, { name: 'web_fetch' }],
  variables: {},
});

test('the row declares the plugin identity and injects nothing hard', () => {
  assert.equal(name, 'websearch-toggle');
  assert.deepEqual(inject, [], 'every service it uses is optional, so a composition missing one still boots');
  assert.equal(SETTINGS_NAMESPACE, 'websearch-toggle', 'on 0.1.7 the namespace IS the Loader entry id');
});

test('the namespace is the Loader entry id declared in cordis.patch.yml', () => {
  // 0.1.7 keys settings forms by `configEditor.entries()` -> `options.id`. A
  // namespace this plugin INVENTS cannot be reached by its own browser half:
  // `configForms.get(...)` would find nothing, the form would never leave
  // `status: 'loading'`, and the switch would sit disabled — the reported bug.
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  const id = /-\s*id:\s*([A-Za-z0-9_-]+)/u.exec(patch)?.[1];
  assert.equal(id, SETTINGS_NAMESPACE, 'the row id and the settings namespace must be one value');
  assert.ok(source.includes(`const NS = '${SETTINGS_NAMESPACE}'`), 'the browser half must use the same namespace');
});

test('the switch is a Config schema whose field is a live volatile accessor', () => {
  // `.volatile()` does two things, and the plugin needs both:
  //
  //  * it is the ONLY reason `SettingsForms.describe()` keeps this entry at all —
  //    `volatileForm()` drops fields without `meta.volatile` and returns
  //    undefined when nothing is left, and describe() then skips the entry, so a
  //    non-volatile schema yields NO namespace for the browser to reach;
  //  * it makes the resolved field a LIVE accessor (`{ get() }`) rather than a
  //    plain value, which is what `config.enabled.get()` reads per step.
  const field = Config({}).enabled;
  assert.equal(typeof field.get, 'function', '.volatile() must produce a live accessor');
  assert.equal(field.get(), true, 'an absent field is the default, not an error');
  assert.equal(Config({ enabled: false }).enabled.get(), false);
  assert.equal(Config({ enabled: true }).enabled.get(), true);
  assert.throws(() => Config({ enabled: 'off' }), 'a bad value must be a loud rejection');
});

test('the field is marked volatile in the wire schema', () => {
  // The regression: a Config whose field lacks `meta.volatile` is invisible to
  // the settings system, so `settings.describe()` never lists the namespace and
  // the browser half has nothing to read or write. `enabled()` in lib/index.js
  // accepts a plain boolean too, so nothing else would have caught it.
  const wire = Config.toJSON();
  const bool = Object.values(wire.refs).find((node) => node !== null && typeof node === 'object' && node.type === 'boolean');
  assert.ok(bool !== undefined, 'the boolean field must be in the wire schema');
  assert.equal(bool.meta?.volatile, true, 'without meta.volatile the namespace is never served');
});

test('the Config schema is a REAL schemastery schema, because describe() serializes it', () => {
  // The regression this guards: `settings.describe()` serializes every served
  // schema with `toJSON()` and hands the result to the browser. A hand-rolled
  // validator without it threw inside describe(), which removed the Shell, Agent
  // loop, Subagent AND Web search pages from the Plugins page.
  assert.equal(typeof Config.toJSON, 'function', 'describe() requires toJSON or it throws');
  const wire = Config.toJSON();
  assert.equal(typeof wire, 'object');
  assert.ok(wire !== null, 'toJSON must produce an object');
  const objectNode = Object.values(wire.refs).find((node) => node !== null && typeof node === 'object' && node.dict !== undefined);
  assert.ok(objectNode !== undefined, 'the wire form must describe an object with fields');
  assert.equal(typeof objectNode.dict.enabled, 'number', '`enabled` must be a declared field');
});

test('the live config accessor is consulted per step, not cached at boot', async () => {
  // `config.enabled.get()` must be read at each assembly and each guard: that is
  // what makes a settings write take effect on the NEXT step rather than the next
  // restart. A cached-at-boot value would pass every other test in this file.
  const booted = boot({ enabled: true });
  const entry = booted.listenerFor('system-prompt/assemble');

  const before = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(before.tools.map((tool) => tool.name), ['read', 'web_search', 'web_fetch']);

  await booted.commit(false);

  const after = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(after.tools.map((tool) => tool.name), ['read', 'web_fetch'], 'the live value must be re-read');
  assert.deepEqual(after.sections.map((section) => section.name), ['persona']);
});

test('a config accessor returning a plain boolean is accepted too', async () => {
  // Belt and braces for a deployment that hands the config over already unwrapped.
  const booted = boot({ enabled: false });
  booted.config.enabled = false;
  const entry = booted.listenerFor('system-prompt/assemble');
  const projected = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(projected.tools.map((tool) => tool.name), ['read', 'web_fetch']);
});

test('a committed OFF is in force before the first assembly', async () => {
  const booted = boot({ enabled: false });
  const entry = booted.listenerFor('system-prompt/assemble');
  assert.ok(entry !== undefined, 'the assembly waterfall must be wired');
  const projected = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(projected.tools.map((tool) => tool.name), ['read', 'web_fetch']);
  assert.deepEqual(projected.sections.map((section) => section.name), ['persona']);
});

test('flipping the switch changes the very next assembly, with no restart', async () => {
  const booted = boot({ enabled: true });
  const entry = booted.listenerFor('system-prompt/assemble');

  const on = await entry.listener(assembly(), {}, async () => assembly());
  assert.equal(on.tools.length, 3, 'ON leaves the catalog alone');

  await booted.commit(false);
  const off = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(off.tools.map((tool) => tool.name), ['read', 'web_fetch']);

  await booted.commit(true);
  const backOn = await entry.listener(assembly(), {}, async () => assembly());
  assert.equal(backOn.tools.length, 3, 'and it comes back the same way');
});

test('the tool guard is registered globally and follows the switch', async () => {
  const booted = boot({ enabled: true });
  assert.equal(booted.injected.includes('tools'), true);
  assert.equal(booted.guards.length, 1);
  assert.equal(booted.guards[0]({ name: 'web_search' }), undefined, 'ON must let the call through');

  await booted.commit(false);
  assert.equal(typeof booted.guards[0]({ name: 'web_search' }), 'string');
  assert.equal(booted.guards[0]({ name: 'web_fetch' }), undefined, 'web_fetch is a different capability and stays');
});

test('a deployment with no config at all keeps the shipped ON', async () => {
  // `apply(ctx)` with no config must not throw and must not silently disable the
  // capability: an absent field is the schema default, which is ON.
  const booted = boot({ enabled: true });
  delete booted.config.enabled;
  const entry = booted.listenerFor('system-prompt/assemble');
  const projected = await entry.listener(assembly(), {}, async () => assembly());
  assert.deepEqual(projected.tools.map((tool) => tool.name), ['read', 'web_search', 'web_fetch']);
});

test('a deployment without a tool registry still boots and keeps the assembly half', () => {
  const booted = boot({ services: ['systemPrompt'] });
  assert.equal(booted.guards.length, 0);
  assert.ok(booted.listenerFor('system-prompt/assemble') !== undefined);
});

test('every effect this plugin registers is disposable', () => {
  const booted = boot();
  for (const entry of booted.effects) {
    assert.equal(typeof entry.dispose === 'function' || entry.dispose === undefined, true, `effect has no disposer: ${entry.label}`);
  }
});
