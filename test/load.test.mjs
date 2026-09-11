/**
 * Load-layer tests for the browser half.
 *
 * The bundle is a classic script, so it is evaluated here with a fake
 * `window`/`document`. Every assertion that claims "the code did X" also counts
 * the calls that prove it: the failure mode this suite exists to catch is a
 * branch that silently early-returns, which is how a nav glyph shipped broken
 * twice in this family of plugins while the suite stayed green.
 *
 * @module dsh-websearch-toggle/test/load
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** One fake element, good enough for the bundle's DOM use. */
function makeElement(tag, scans) {
  const element = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attributes: {},
    dataset: {},
    children: [],
    childElementCount: 0,
    parentNode: null,
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    listeners: {},
    get isConnected() {
      let cursor = element;
      while (cursor.parentNode !== null && cursor.parentNode !== undefined) cursor = cursor.parentNode;
      return cursor === scans.root;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name) ? element.attributes[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name);
    },
    removeAttribute(name) {
      delete element.attributes[name];
    },
    appendChild(child) {
      attach(element, child, element.children.length);
      return child;
    },
    insertBefore(child, before) {
      const index = before === null || before === undefined ? 0 : element.children.indexOf(before);
      attach(element, child, index < 0 ? 0 : index);
      return child;
    },
    addEventListener(type, listener) {
      (element.listeners[type] = element.listeners[type] || []).push(listener);
    },
    click() {
      for (const listener of element.listeners.click || []) listener({});
    },
    remove() {
      detach(element);
    },
    querySelectorAll(selector) {
      scans.subtree += 1;
      return collect(element, selector);
    },
  };
  return element;
}

/** Attach a child at an index, keeping the counters the bundle reads honest. */
function attach(parent, child, index) {
  if (child.parentNode !== null && child.parentNode !== undefined) detach(child);
  child.parentNode = parent;
  parent.children.splice(index, 0, child);
  parent.childElementCount = parent.children.length;
}

/** Detach a node from its parent. */
function detach(child) {
  const parent = child.parentNode;
  if (parent !== null && parent !== undefined) {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
    parent.childElementCount = parent.children.length;
  }
  child.parentNode = null;
}

/** Depth-first descendant search by tag name. */
function collect(node, selector) {
  const wanted = String(selector).toUpperCase();
  const found = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (child.tagName === wanted) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}

/** The shipped card: header button with title + description, body only while open. */
function makeCard(scans, title, open) {
  const li = makeElement('li', scans);
  const button = makeElement('button', scans);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  const head = makeElement('span', scans);
  const name = makeElement('span', scans);
  name.textContent = title;
  const description = makeElement('span', scans);
  description.textContent = 'The DeepSeek search provider.';
  head.appendChild(name);
  head.appendChild(description);
  button.appendChild(head);
  li.appendChild(button);

  const body = makeElement('div', scans);
  if (open) {
    const field = makeElement('div', scans);
    field.appendChild(makeElement('input', scans));
    body.appendChild(field);
    const footer = makeElement('div', scans);
    footer.appendChild(makeElement('button', scans));
    body.appendChild(footer);
    li.appendChild(body);
  }
  scans.root.body.appendChild(li);
  return { li, button, body, name };
}

/** The row's parts, read straight out of the DOM the bundle built. */
function rowParts(row) {
  const line = row.children[0];
  return { line, label: line.children[0], toggle: line.children[1], hint: row.children[1], error: row.children[2] };
}

/**
 * Evaluate the bundle against a fake page and run `apply`.
 * @param options - `locale` (active id) and `answers` (route → envelope).
 * @returns captured module, the fake page, and every counter the assertions use.
 */
function loadClient(options = {}) {
  const scans = { subtree: 0, doc: 0 };
  const styleTags = [];
  const observers = [];
  const timers = [];
  const calls = [];
  let callback = null;
  let captured = null;

  const body = makeElement('body', scans);
  // `head` participates in the parent chain on purpose: the stylesheet effect's
  // cleanup is only proven if the style tag reads as connected before dispose
  // and detached after it.
  const head = {
    nodeType: 1,
    tagName: 'HEAD',
    children: [],
    childElementCount: 0,
    parentNode: null,
    appendChild(tag) {
      attach(head, tag, head.children.length);
      styleTags.push(tag);
      return tag;
    },
  };
  const doc = {
    nodeType: 9,
    body,
    head,
    createElement: (tag) => makeElement(tag, scans),
    querySelectorAll: (selector) => {
      scans.doc += 1;
      return collect(body, selector);
    },
  };
  head.parentNode = doc;
  body.parentNode = doc;
  scans.root = doc;

  class FakeObserver {
    constructor(listener) {
      callback = listener;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }

  const answers = options.answers === undefined ? {} : options.answers;
  function fakeFetch(url, init) {
    calls.push({ url, body: JSON.parse(init.body) });
    const endpoint = String(url).split('/').pop();
    const answered = answers[endpoint] === undefined
      ? { ok: true, value: { enabled: true, known: true, tool: 'web_search' } }
      : answers[endpoint];
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve(answered),
    });
  }

  const win = { __ModuleLoader__: { load: (m) => { captured = m; } } };
  new Function('window', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', 'fetch', source)(
    win,
    doc,
    FakeObserver,
    // Recorded, never scheduled: the 400ms backstop must not fire behind the
    // assertions, and every timer path is asserted through `timers` instead.
    (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    () => {},
    fakeFetch,
  );

  const localeRegisters = [];
  const effects = [];
  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    locale: {
      getSnapshot: () => ({ active: options.locale === undefined ? 'zh' : options.locale, locales: [{ id: 'en' }, { id: 'zh' }] }),
      register: (ns, id, dict) => {
        localeRegisters.push({ ns, id, dict });
        return () => {};
      },
      bind: () => undefined,
      subscribe: () => () => {},
    },
  };

  const mod = captured.factory(() => {
    throw new Error('the browser half must not require anything');
  });
  mod.apply(ctx);

  return {
    mod,
    doc,
    body,
    scans,
    styleTags,
    observers,
    timers,
    calls,
    effects,
    localeRegisters,
    makeCard: (title, open) => makeCard(scans, title, open),
    /** Drive the captured MutationObserver callback by hand. */
    fire: (addedNodes) => callback([{ addedNodes }]),
    styleEffect: () => effects.find((entry) => entry.label.includes('stylesheet')),
    cardEffect: () => effects.find((entry) => entry.label.includes('web search card')),
  };
}

/** Let every microtask from the stubbed fetch settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the bundle registers itself under the package name', () => {
  const loaded = loadClient();
  assert.equal(typeof loaded.mod.apply, 'function');
  assert.deepEqual(loaded.mod.inject, ['locale']);
});

test('the bundle id is the package name and inject asks only for the locale', () => {
  const match = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/u.exec(source);
  assert.equal(match[1], pkg.name, 'a mismatched id is a silently unloaded bundle');
  const module = loadClient().mod;
  assert.deepEqual(module.inject, ['locale']);
});

test('the stylesheet is injected, prefixed, token-only, and tied to the fiber', () => {
  const loaded = loadClient();
  assert.equal(loaded.styleTags.length, 1);
  assert.equal(loaded.styleTags[0].dataset.plugin, 'dsh-websearch-toggle');
  const css = loaded.styleTags[0].textContent;
  assert.ok(css.includes('.dshwst-switch'), 'the toggle track rule must be present');
  assert.ok(css.includes('.dshwst-switch[aria-checked=true] .dshwst-thumb'), 'the checked thumb rule must be present');
  assert.ok(css.includes('li[data-dshwst-off] > div > :not([data-dshwst-row])'), 'the greyed-out rule must be present');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/u.test(css), 'no hex colours');
  assert.ok(!/\brgba?\(/u.test(css), 'no rgb()/rgba() colours');
  assert.ok(!/[:,]\s*(white|black)\b/iu.test(css), 'no named colours');
  assert.ok(css.includes('var(--dsw-alias-'), 'colours must come from alias tokens');
  for (const name of [...css.matchAll(/\.([a-zA-Z][\w-]*)/gu)].map((entry) => entry[1])) {
    assert.ok(name.startsWith('dshwst-'), `unprefixed class in the stylesheet: ${name}`);
  }
  const styleEffect = loaded.styleEffect();
  assert.ok(styleEffect !== undefined, 'the style tag must hang on ctx.effect');
  styleEffect.dispose();
  assert.equal(loaded.styleTags[0].isConnected, false, 'disposing the fiber must remove the style tag');
});

test('both locale dictionaries register and cover the same keys', () => {
  const loaded = loadClient();
  assert.deepEqual(loaded.localeRegisters.map((entry) => entry.id).sort(), ['en', 'zh']);
  assert.equal(loaded.localeRegisters[0].ns, 'dsh-websearch-toggle');
  const en = loaded.localeRegisters.find((entry) => entry.id === 'en').dict;
  const zh = loaded.localeRegisters.find((entry) => entry.id === 'zh').dict;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.equal(en.toggle, 'Enable web search');
  assert.equal(zh.toggle, '启用网页搜索');
});

test('a collapsed card is claimed but gets no switch', () => {
  const loaded = loadClient();
  const card = loaded.makeCard('网页搜索', false);
  loaded.fire([card.li]);
  assert.equal(card.li.hasAttribute('data-dshwst-card'), true, 'the card must be marked for the grey rules');
  assert.equal(collect(card.li, 'div').length, 0, 'a collapsed card has no body to inject into');
});

test('expanding the card injects the switch as the first thing in the body', async () => {
  const loaded = loadClient();
  await settle();
  const card = loaded.makeCard('网页搜索', false);
  loaded.fire([card.li]);

  // The user expands: React inserts the body, which is the mutation we act on.
  const body = makeElement('div', loaded.scans);
  const field = makeElement('div', loaded.scans);
  field.appendChild(makeElement('input', loaded.scans));
  body.appendChild(field);
  card.li.appendChild(body);
  loaded.fire([body]);

  assert.equal(body.children.length, 2, 'the row was inserted without removing the card’s own field');
  const row = body.children[0];
  assert.equal(row.hasAttribute('data-dshwst-row'), true, 'the injected row must be the body’s first child');
  assert.equal(row.className, 'dshwst-row');
  const parts = rowParts(row);
  assert.equal(parts.toggle.getAttribute('role'), 'switch');
  assert.equal(parts.toggle.getAttribute('aria-checked'), 'true');
  assert.equal(parts.toggle.disabled, false);
  assert.equal(parts.label.textContent, '启用网页搜索');
  assert.equal(parts.error.hidden, true);
});

test('the switch is only ever injected once per body', async () => {
  const loaded = loadClient();
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.li]);
  loaded.fire([card.body]);
  loaded.fire([card.li]);
  const rows = collect(card.li, 'div').filter((node) => node.hasAttribute('data-dshwst-row'));
  assert.equal(rows.length, 1, 're-patching must adopt the row it finds, not build a second one');
});

test('the released row comes back after a collapse and re-expand', async () => {
  const loaded = loadClient();
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  const first = card.body.children[0];
  assert.equal(first.hasAttribute('data-dshwst-row'), true);

  card.body.remove();
  const reopened = makeElement('div', loaded.scans);
  card.li.appendChild(reopened);
  loaded.fire([reopened]);
  assert.equal(reopened.children[0].hasAttribute('data-dshwst-row'), true);
  assert.notEqual(reopened.children[0], first, 'the rebuilt body needs a freshly injected row');
});

test('the mount scan is the only document-wide one, and steady state costs nothing', async () => {
  const loaded = loadClient();
  await settle();
  assert.equal(loaded.observers.length, 1, 'an observer must actually be created');
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  assert.equal(loaded.scans.doc, 1, 'the initial scan is document-wide exactly once');

  const subtree = loaded.scans.subtree;
  const doc = loaded.scans.doc;
  for (let i = 0; i < 200; i += 1) loaded.fire([makeElement('div', loaded.scans)]);
  assert.equal(loaded.scans.subtree, subtree, 'the hot path must exit before scanning anything');
  assert.equal(loaded.scans.doc, doc, 'the hot path must never fall back to a document scan');
});

test('an inserted subtree is scanned, not the whole document', async () => {
  const loaded = loadClient();
  await settle();
  const doc = loaded.scans.doc;
  const stray = makeElement('div', loaded.scans);
  loaded.fire([stray]);
  assert.equal(loaded.scans.doc, doc, 'a subtree insertion must not trigger a document scan');
});

test('a title written as a text node still claims the card', async () => {
  const loaded = loadClient();
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  card.li.removeAttribute('data-dshwst-card');
  const text = { nodeType: 3, textContent: '网页搜索', parentNode: card.name };
  loaded.fire([text]);
  assert.equal(card.li.hasAttribute('data-dshwst-card'), true, 'the text-node branch must resolve the enclosing card');
});

test('a card that is not the web search card is left untouched', async () => {
  const loaded = loadClient();
  await settle();
  const shell = loaded.makeCard('终端', true);
  loaded.fire([shell.body]);
  assert.equal(shell.li.hasAttribute('data-dshwst-card'), false);
  assert.equal(collect(shell.li, 'div').some((node) => node.hasAttribute('data-dshwst-row')), false);
});

test('the English card is claimed too, so a language switch keeps the switch', async () => {
  const loaded = loadClient({ locale: 'en' });
  await settle();
  const card = loaded.makeCard('Web search', true);
  loaded.fire([card.body]);
  const row = card.body.children[0];
  assert.equal(row.hasAttribute('data-dshwst-row'), true);
  assert.equal(rowParts(row).label.textContent, 'Enable web search');
});

test('an OFF host state greys the card and paints the switch off', async () => {
  const loaded = loadClient({
    answers: { state: { ok: true, value: { enabled: false, known: true, tool: 'web_search' } } },
  });
  await settle();
  assert.deepEqual(loaded.calls.map((entry) => entry.url), ['/websearch-toggle/state'], 'exactly one read, and no polling');
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  const parts = rowParts(card.body.children[0]);
  assert.equal(card.li.hasAttribute('data-dshwst-off'), true, 'the grey rules hang off this attribute');
  assert.equal(parts.toggle.getAttribute('aria-checked'), 'false');
  assert.equal(parts.hint.textContent, loaded.localeRegisters.find((entry) => entry.id === 'zh').dict.off);
});

test('clicking the switch writes through the host and updates the card', async () => {
  const loaded = loadClient({
    answers: {
      state: { ok: true, value: { enabled: true, known: true, tool: 'web_search' } },
      set: { ok: true, value: { enabled: false, known: true, tool: 'web_search' } },
    },
  });
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  const parts = rowParts(card.body.children[0]);

  parts.toggle.click();
  assert.equal(parts.toggle.disabled, true, 'the control is disabled while the write is in flight');
  await settle();

  const write = loaded.calls.find((entry) => entry.url.endsWith('/set'));
  assert.deepEqual(write.body, { enabled: false });
  assert.equal(parts.toggle.getAttribute('aria-checked'), 'false');
  assert.equal(parts.toggle.disabled, false);
  assert.equal(card.li.hasAttribute('data-dshwst-off'), true);
});

test('a refused write rolls the switch back and says why', async () => {
  const loaded = loadClient({
    answers: {
      state: { ok: true, value: { enabled: true, known: true, tool: 'web_search' } },
      set: { ok: false, error: { code: 'websearch-toggle/persist-failed', message: 'disk on fire' } },
    },
  });
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  const parts = rowParts(card.body.children[0]);

  parts.toggle.click();
  await settle();

  assert.equal(parts.toggle.getAttribute('aria-checked'), 'true', 'the host is the authority, so the optimistic flip reverts');
  assert.equal(card.li.hasAttribute('data-dshwst-off'), false);
  assert.equal(parts.error.hidden, false);
  assert.equal(parts.error.textContent, 'disk on fire');
});

test('an unanswered host leaves the switch disabled instead of guessing', async () => {
  const loaded = loadClient({
    answers: { state: { ok: false, error: { code: 'websearch-toggle/internal', message: 'boom' } } },
  });
  await settle();
  const card = loaded.makeCard('网页搜索', true);
  loaded.fire([card.body]);
  const parts = rowParts(card.body.children[0]);
  assert.equal(parts.toggle.disabled, true, 'an unconfirmed position must not be painted as a real one');
  assert.equal(parts.error.textContent, 'boom');
});

test('the style and observer effects both clean up', async () => {
  const loaded = loadClient();
  await settle();
  const cardEffect = loaded.cardEffect();
  assert.ok(cardEffect !== undefined);
  cardEffect.dispose();
  assert.equal(loaded.observers[0].disconnected, true, 'the observer must be disconnected on dispose');
});
