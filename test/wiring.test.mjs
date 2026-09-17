/**
 * Host-wiring tests for the host half.
 *
 * Since DSH 0.1.6 the host half registers no route of its own: the browser
 * writes the switch through the platform's settings Remote, and the Host learns
 * about the commit through the namespace it installed. So what these assert is
 * the wiring the browser depends on — the namespace is installed even though
 * this package owns no settings storage itself, the composition entry's default
 * is the shipped ON, the assembly waterfall withholds the tool, and the guard
 * follows the switch.
 *
 * @module dsh-websearch-toggle/test/wiring
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, name, SETTINGS_NAMESPACE, SettingsSchema } from '../lib/index.js';
import { WEB_SEARCH_SECTION } from '../lib/host-core.js';

/**
 * Boot the host half against a stub context that models the services it uses.
 * @param options - `enabled` seeds the committed section; `services` limits which
 *   optional services exist, so a deployment missing one is covered too.
 * @returns the captured registrations plus the lever a settings commit pulls.
 */
function boot(options = {}) {
  const committed = { value: { enabled: options.enabled === undefined ? true : options.enabled } };
  const have = new Set(options.services === undefined ? ['settings', 'systemPrompt', 'tools'] : options.services);

  const listeners = [];
  const guards = [];
  const injected = [];
  const installed = [];
  const effects = [];

  const settings = {
    installSection(owner, ns, schema, entry, hooks) {
      installed.push({ owner, ns, schema, entry, hooks });
      hooks.setSource(() => committed.value);
    },
    update: async (ns, patch) => {
      committed.value = { ...committed.value, ...patch };
      for (const registration of installed) registration.hooks.onChange();
    },
    get: () => committed.value,
  };

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
      if (service === 'settings') return settings;
      return {};
    },
    inject(deps, callback) {
      injected.push(...deps);
      if (!deps.every((dep) => have.has(dep))) return () => {};
      if (deps.includes('settings')) callback({ settings, effect: ctx.effect, on: ctx.on });
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

  apply(ctx);

  return {
    ctx,
    listeners,
    guards,
    injected,
    installed,
    effects,
    committed,
    listenerFor: (event) => listeners.find((entry) => entry.event === event),
    /** Commit a new position the way a settings write does. */
    commit: async (enabled) => {
      await settings.update(SETTINGS_NAMESPACE, { enabled });
    },
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
  assert.equal(SETTINGS_NAMESPACE, 'web-search-toggle');
});

test('the switch is a registered settings section with the shipped default ON', () => {
  const booted = boot();
  assert.equal(booted.installed.length, 1, 'the namespace must actually be installed');
  const registration = booted.installed[0];
  assert.equal(registration.ns, 'web-search-toggle');
  assert.deepEqual(registration.entry, { enabled: true }, 'an absent section means ON, never OFF');
  assert.equal(typeof registration.hooks.setSource, 'function');
  assert.equal(typeof registration.hooks.onChange, 'function');
});

test('the schema is a REAL schemastery schema, because describe() serializes it', () => {
  // The regression this guards: `settings.describe()` calls `schema.toJSON()` and
  // hands the result to the browser, and that ONE call gates every official
  // plugin page — each registers only for a namespace it sees in that list. A
  // hand-rolled validator without toJSON threw inside describe(), which removed
  // the Shell, Agent loop, Subagent AND Web search pages from the Plugins page.
  assert.equal(typeof SettingsSchema.toJSON, 'function', 'describe() requires toJSON or it throws');
  const wire = SettingsSchema.toJSON();
  assert.equal(typeof wire, 'object');
  assert.ok(wire !== null, 'toJSON must produce an object');
  // The real shape is an interned { uid, refs } graph; the object schema is
  // always a refs entry whose `dict` maps the field name to its ref id.
  const objectNode = Object.values(wire.refs).find((node) => node !== null && typeof node === 'object' && node.dict !== undefined);
  assert.ok(objectNode !== undefined, 'the wire form must describe an object with fields');
  assert.equal(typeof objectNode.dict.enabled, 'number', '`enabled` must be a declared field');
});

test('the schema resolves an absent section to the shipped default ON', () => {
  assert.deepEqual(SettingsSchema({}), { enabled: true }, 'an absent field is the default, not an error');
  assert.deepEqual(SettingsSchema({ enabled: false }), { enabled: false });
  assert.deepEqual(SettingsSchema({ enabled: true }), { enabled: true });
  assert.throws(() => SettingsSchema({ enabled: 'off' }), 'a bad value must be a loud rejection');
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

test('a deployment without a settings service still boots and keeps the switch ON', () => {
  const booted = boot({ services: ['systemPrompt', 'tools'] });
  assert.equal(booted.installed.length, 0);
  assert.ok(booted.listenerFor('system-prompt/assemble') !== undefined, 'the rest of the plugin must still mount');
  assert.equal(booted.guards.length, 1);
});

test('a deployment without a tool registry still boots and keeps the assembly half', () => {
  const booted = boot({ services: ['settings', 'systemPrompt'] });
  assert.equal(booted.installed.length, 1);
  assert.equal(booted.guards.length, 0);
  assert.ok(booted.listenerFor('system-prompt/assemble') !== undefined);
});

test('every effect this plugin registers is disposable', () => {
  const booted = boot();
  for (const entry of booted.effects) {
    assert.equal(typeof entry.dispose === 'function' || entry.dispose === undefined, true, `effect has no disposer: ${entry.label}`);
  }
});
