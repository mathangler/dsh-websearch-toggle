/**
 * Core-layer tests: the toggle's state machine and the two projections the host
 * effects use.
 *
 * The core is transport-free on purpose, so everything here runs against an
 * injected in-memory storage seam — no server, no fabricated request objects,
 * no settings file.
 *
 * @module dsh-websearch-toggle/test/host-core
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCore,
  createHandlers,
  ToggleError,
  NAMESPACE,
  WEB_SEARCH_TOOL,
  WEB_SEARCH_SECTION,
} from '../lib/host-core.js';

/** A core over a section held in memory, plus the store it writes through. */
function memoryCore(initial) {
  const store = { section: initial === undefined ? undefined : { ...initial }, writes: [], failures: 0 };
  const core = createCore({
    read: () => store.section,
    write: async (enabled) => {
      if (store.failures > 0) {
        store.failures -= 1;
        throw new ToggleError('websearch-toggle/persist-failed', 'disk on fire');
      }
      store.writes.push(enabled);
      store.section = { enabled };
    },
  });
  return { core, store };
}

/** One assembled prompt shaped like the platform's `PromptAssembly`. */
const assembly = () => ({
  sections: [
    { name: 'persona', text: 'You are a coding agent.' },
    { name: WEB_SEARCH_SECTION, text: 'Use the web_search tool to discover current information.' },
    { name: 'tool:web_fetch', text: 'Use web_fetch for a specific result.' },
  ],
  contexts: [],
  tools: [
    { name: 'read', description: 'read a file', parameters: {} },
    { name: WEB_SEARCH_TOOL, description: 'search the web', parameters: {} },
    { name: 'web_fetch', description: 'fetch a url', parameters: {} },
  ],
  variables: {},
});

test('the namespace and the governed names are the platform spellings', () => {
  // On 0.1.7 a settings namespace IS the Loader entry id, so this is the row id
  // from cordis.patch.yml — not a name this plugin invents.
  assert.equal(NAMESPACE, 'websearch-toggle');
  assert.equal(WEB_SEARCH_TOOL, 'web_search');
  assert.equal(WEB_SEARCH_SECTION, 'tool:web_search');
});

test('the default is ON and unconfirmed until storage has answered', () => {
  const { core } = memoryCore();
  assert.deepEqual(core.snapshot(), { enabled: true, known: false, tool: 'web_search' });
});

test('reload adopts a stored section and ignores anything else', () => {
  const { core, store } = memoryCore({ enabled: false });
  assert.equal(core.reload().enabled, false);
  assert.equal(core.snapshot().known, true);

  store.section = { enabled: 'no' };
  assert.equal(core.reload().enabled, false, 'a non-boolean must not move the switch');
  store.section = undefined;
  assert.equal(core.reload().enabled, false);
});

test('setEnabled writes before it adopts, and adopts what it wrote', async () => {
  const { core, store } = memoryCore();
  const snapshot = await core.setEnabled(false);
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.known, true);
  assert.deepEqual(store.writes, [false]);
  assert.deepEqual(store.section, { enabled: false });
});

test('a refused write leaves the effect exactly as it was', async () => {
  const { core, store } = memoryCore({ enabled: true });
  core.reload();
  store.failures = 1;
  await assert.rejects(() => core.setEnabled(false), /disk on fire/u);
  assert.equal(core.snapshot().enabled, true, 'a failed write must not half-apply the switch');
  assert.deepEqual(store.writes, []);
});

test('setEnabled rejects a non-boolean before it writes anything', async () => {
  const { core, store } = memoryCore();
  await assert.rejects(() => core.setEnabled('off'), (error) => {
    assert.equal(error instanceof ToggleError, true);
    assert.equal(error.code, 'websearch-toggle/bad-argument');
    return true;
  });
  assert.deepEqual(store.writes, []);
});

test('createCore refuses a missing seam instead of failing at the first read', () => {
  assert.throws(() => createCore({}), TypeError);
  assert.throws(() => createCore({ read: () => undefined }), TypeError);
  assert.throws(() => createCore(null), TypeError);
});

test('while ON the projection returns the very same assembly', () => {
  const { core } = memoryCore({ enabled: true });
  core.reload();
  const input = assembly();
  assert.equal(core.project(input), input, 'an unchanged catalog must not look changed to the agent loop');
});

test('while OFF the tool and the section that advertises it both leave', () => {
  const { core } = memoryCore({ enabled: false });
  core.reload();
  const projected = core.project(assembly());
  assert.deepEqual(projected.tools.map((tool) => tool.name), ['read', 'web_fetch']);
  assert.deepEqual(projected.sections.map((section) => section.name), ['persona', 'tool:web_fetch']);
  assert.deepEqual(projected.contexts, [], 'untouched fields are carried over');
});

test('a projection that changed nothing is identity, so the tool list stays byte-identical', () => {
  const { core } = memoryCore({ enabled: false });
  core.reload();
  const input = {
    sections: [{ name: 'persona', text: 'x' }],
    contexts: [],
    tools: [{ name: 'read' }],
    variables: {},
  };
  assert.equal(core.project(input), input);
});

test('the projection tolerates a malformed assembly rather than failing the step', () => {
  const { core } = memoryCore({ enabled: false });
  core.reload();
  assert.equal(core.project(undefined), undefined);
  assert.equal(core.project(null), null);
  assert.deepEqual(core.project({ sections: 'nope', tools: 'nope' }), { sections: 'nope', tools: 'nope' });
});

test('the guard refuses exactly the governed tool, and only while OFF', () => {
  const on = memoryCore({ enabled: true }).core;
  on.reload();
  assert.equal(on.deny('web_search'), undefined);
  assert.equal(on.deny('web_fetch'), undefined);

  const off = memoryCore({ enabled: false }).core;
  off.reload();
  assert.equal(typeof off.deny('web_search'), 'string');
  assert.match(off.deny('web_search'), /turned off/u);
  assert.equal(off.deny('web_fetch'), undefined, 'web_fetch is a different capability and stays');
});

test('the handlers speak the platform envelope', async () => {
  const { core, store } = memoryCore();
  const handlers = createHandlers(core);

  assert.deepEqual(await handlers.state(), { enabled: true, known: false, tool: 'web_search' });
  assert.deepEqual(await handlers.set({ enabled: false }), { enabled: false, known: true, tool: 'web_search' });
  assert.deepEqual(store.writes, [false]);
  assert.deepEqual(await handlers.state(), { enabled: false, known: true, tool: 'web_search' });
});

test('the set handler rejects a bad payload as a business failure, not a crash', async () => {
  const { core } = memoryCore();
  const handlers = createHandlers(core);
  await assert.rejects(() => handlers.set({}), (error) => error instanceof ToggleError);
  await assert.rejects(() => handlers.set(null), (error) => error instanceof ToggleError);
});
