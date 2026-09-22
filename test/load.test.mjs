/**
 * Load-layer tests for the browser half.
 *
 * The bundle is a classic script, so it is evaluated here with a fake
 * `window`/`document`. Every assertion that claims "the code did X" also counts
 * what it touched, because the failure this suite exists to catch is a branch
 * that silently early-returns while the suite stays green.
 *
 * What this half owes the page is narrow: it must attach ONE switch to the
 * OFFICIAL Web search card, in the trailing position installed bundle cards use,
 * without touching anything official — and it must detach cleanly when the
 * bundle unloads.
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

/** One fake element, good enough for this bundle's DOM use. */
function makeElement(tag, scans) {
  const element = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attributes: {},
    dataset: {},
    className: '',
    children: [],
    childElementCount: 0,
    parentNode: null,
    disabled: false,
    title: '',
    textContent: '',
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
    matches(selector) {
      return selector === `li[data-plugin-item="${element.attributes['data-plugin-item']}"]`
        && element.tagName === 'LI'
        && element.hasAttribute('data-plugin-item');
    },
    appendChild(child) {
      attach(element, child, element.children.length);
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
    get firstElementChild() {
      return element.children.length === 0 ? null : element.children[0];
    },
    querySelector(selector) {
      const marker = selector.replace(/^\[|\]$/gu, '');
      if (selector.startsWith('li[data-plugin-item=')) {
        const wanted = selector.replace(/^li\[data-plugin-item="|"\]$/gu, '');
        const found = walk(element).find((node) => node.tagName === 'LI' && node.getAttribute('data-plugin-item') === wanted);
        return found === undefined ? null : found;
      }
      const found = walk(element).find((node) => node.hasAttribute(marker));
      return found === undefined ? null : found;
    },
  };
  return element;
}

/** Every descendant of a node (not including it). */
function walk(node) {
  const out = [];
  const visit = (current) => {
    for (const child of current.children) {
      out.push(child);
      visit(child);
    }
  };
  visit(node);
  return out;
}

function attach(parent, child, index) {
  if (child.parentNode !== null && child.parentNode !== undefined) detach(child);
  child.parentNode = parent;
  parent.children.splice(index, 0, child);
  parent.childElementCount = parent.children.length;
}

function detach(child) {
  const parent = child.parentNode;
  if (parent !== null && parent !== undefined) {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
    parent.childElementCount = parent.children.length;
  }
  child.parentNode = null;
}

/**
 * Evaluate the bundle against a fake page and run `apply`.
 * @param options - `enabled` seeds the namespace, `updateFails` refuses writes.
 * @returns the captured module plus everything the assertions count.
 */
function loadClient(options = {}) {
  const scans = { root: null };
  const styleTags = [];
  const effects = [];
  const localeRegisters = [];
  const writes = [];
  const boundNamespaces = [];
  const observers = [];
  let callback = null;

  const body = makeElement('body', scans);
  const head = { nodeType: 1, tagName: 'HEAD', children: [], childElementCount: 0, parentNode: null, appendChild(tag) { attach(head, tag, head.children.length); styleTags.push(tag); return tag; } };
  const doc = {
    nodeType: 9,
    body,
    head,
    createElement: (tag) => makeElement(tag, scans),
    querySelector: (selector) => {
      const wanted = selector.replace(/^li\[data-plugin-item="|"\]$/gu, '');
      const found = walk(body).find((node) => node.tagName === 'LI' && node.getAttribute('data-plugin-item') === wanted);
      return found === undefined ? null : found;
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

  let enabled = options.enabled === undefined ? true : options.enabled;
  let revision = 5;
  // A cold mirror reports `loading` for its first read, then `ready` — which is
  // what the real describe mirror does while its Remote is still in flight.
  let coldLeft = options.coldFirstRead === true ? 1 : 0;
  const notify = [];

  /**
   * The per-namespace settings form, modelled on 0.1.7's ConfigFormController:
   * it owns the revision, writes through `set(field, value)`, and re-reads after
   * its own write.
   */
  const scope = {
    getSnapshot() {
      if (coldLeft > 0) {
        coldLeft -= 1;
        return { status: 'loading', value: undefined, revision: undefined, writable: false };
      }
      return { status: 'ready', value: { enabled }, revision, writable: options.writable !== false };
    },
    subscribe(fn) {
      notify.push(fn);
      return () => {
        const at = notify.indexOf(fn);
        if (at >= 0) notify.splice(at, 1);
      };
    },
    set(field, value) {
      writes.push({ field, value, revision });
      // A fence race: refuse the first attempt the way a concurrent commit would.
      if (refusesLeft > 0) {
        refusesLeft -= 1;
        revision += 1;
        return Promise.reject(new Error('revision conflict'));
      }
      if (options.updateFails === true) return Promise.reject(new Error('conflict'));
      enabled = value;
      revision += 1;
      return Promise.resolve();
    },
  };

  /** 0.1.7's service. `get(namespace)` returns the shared form for it. */
  const configForms = {
    get: (namespace) => {
      boundNamespaces.push(namespace);
      return scope;
    },
    describe: () => ({ getSnapshot: () => ({ view: { namespaces: [] } }), subscribe: () => () => {} }),
  };

  let refusesLeft = options.refuseOnce === true ? 1 : 0;

  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    get: (service) => (service === 'configForms' ? configForms : undefined),
    remote: { settings: { update: () => Promise.reject(new Error('this bundle must not call the Remote directly')) } },
    locale: {
      getSnapshot: () => ({ active: options.locale === undefined ? 'zh' : options.locale, locales: [{ id: 'en' }, { id: 'zh' }] }),
      register: (ns, id, dict) => { localeRegisters.push({ ns, id, dict }); return () => {}; },
      bind: () => undefined,
      subscribe: () => () => {},
    },
  };

  let captured = null;
  const win = { __ModuleLoader__: { load: (m) => { captured = m; } } };
  new Function('window', 'document', 'MutationObserver', 'setTimeout', 'clearTimeout', source)(
    win,
    doc,
    FakeObserver,
    () => 1,
    () => {},
  );

  const mod = captured.factory(() => {
    throw new Error('the browser half must not require anything');
  });
  mod.apply(ctx);

  /** The official card, shaped like the page renders it. */
  function makeCard(id, withSwitchHost = true) {
    const li = makeElement('li', scans);
    li.setAttribute('data-plugin-item', id);
    if (withSwitchHost) {
      const head = makeElement('div', scans);
      const icon = makeElement('span', scans);
      const main = makeElement('div', scans);
      const titleRow = makeElement('div', scans);
      titleRow.appendChild(makeElement('button', scans));
      main.appendChild(titleRow);
      head.appendChild(icon);
      head.appendChild(main);
      li.appendChild(head);
    }
    body.appendChild(li);
    return li;
  }

  return {
    mod,
    doc,
    body,
    scans,
    styleTags,
    effects,
    localeRegisters,
    writes,
    boundNamespaces,
    observers,
    makeCard,
    /** Drive the captured MutationObserver callback by hand. */
    fire: (addedNodes) => callback([{ addedNodes }]),
    /** Let the mocked Remote settle. */
    settle: () => new Promise((resolve) => setImmediate(resolve)),
    notifyStore: () => {
      for (const fn of [...notify]) fn();
    },
    /** The value the store actually holds — what a reload would read. */
    stored: () => enabled,
    cardEffect: () => effects.find((entry) => entry.label.includes('web search switch')),
    styleEffect: () => effects.find((entry) => entry.label.includes('stylesheet')),
  };
}

/** The injected block on a card, or null. */
const endOf = (card) => walk(card).find((node) => node.hasAttribute('data-dshwst-end')) ?? null;

test('the bundle id is the package name and it injects only services 0.1.7 provides', () => {
  const match = /__ModuleLoader__.load\(\{\s*id:\s*'([^']+)'/u.exec(source);
  assert.equal(match[1], pkg.name, 'a mismatched id is a silently unloaded bundle');
  // Regression: 0.1.7 REMOVED `settingsScope` and replaced it with
  // `configForms`. Injecting a service that no longer exists leaves the plugin's
  // fiber waiting forever, and the page reports the plugin as broken — which is
  // exactly what happened. test/service-contract.mjs checks these names against
  // the installed packages; this asserts the literal value that broke.
  assert.deepEqual(loadClient().mod.inject, ['locale', 'configForms']);
  assert.ok(!loadClient().mod.inject.includes('settingsScope'), 'settingsScope does not exist in 0.1.7');
});

test('the form is obtained through configForms.get(namespace)', async () => {
  const loaded = loadClient();
  await loaded.settle();
  assert.deepEqual(loaded.boundNamespaces, ['web-search-toggle'], 'the form must be keyed by the settings namespace');
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  assert.equal(endOf(card).dshwstSwitch.disabled, false, 'a form snapshot must reach the switch');
});

test('it registers NO slot, so it can never displace an official entry', () => {
  // The regression this guards: registering into `plugins.item` reuses a cell
  // when the id matches a shipped one, and reusing `web-search` REPLACED the
  // official Web search page instead of adding to it.
  assert.ok(!source.includes("slots.register"), 'no slot registration: the official page must stay untouched');
  assert.ok(!/slots\.inject/u.test(source), 'no slot injection');
  assert.ok(source.includes('data-plugin-item'), 'the official card must be found by its own data attribute');
});

test('the stylesheet is injected, prefixed, token-only, and tied to the fiber', () => {
  const loaded = loadClient();
  assert.equal(loaded.styleTags.length, 1);
  assert.equal(loaded.styleTags[0].dataset.plugin, 'dsh-websearch-toggle');
  const css = loaded.styleTags[0].textContent;
  assert.ok(css.includes('.dshwst-switch'), 'the switch track rule must be present');
  assert.ok(css.includes('.dshwst-switch[aria-checked=true] .dshwst-thumb'), 'the checked thumb rule must be present');
  assert.ok(css.includes('.dshwst-end'), 'the trailing wrapper rule must be present');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/u.test(css), 'no hex colours');
  assert.ok(!/\brgba?\(/u.test(css), 'no rgb()/rgba() colours');
  assert.ok(!/[:,]\s*(white|black)\b/iu.test(css), 'no named colours');
  assert.ok(css.includes('var(--dsw-alias-'), 'colours must come from alias tokens');
  for (const name of [...css.matchAll(/\.([a-zA-Z][\w-]*)/gu)].map((entry) => entry[1])) {
    assert.ok(name.startsWith('dshwst-'), `unprefixed class in the stylesheet: ${name}`);
  }
  const styleEffect = loaded.styleEffect();
  assert.ok(styleEffect !== undefined);
  styleEffect.dispose();
  assert.equal(loaded.styleTags[0].isConnected, false);
});

test('the switch opts out of the global superellipse, like every shell switch', () => {
  // Regression, reported as "the switch looks different from the other plugins'
  // switches". The theme injects
  //   @supports (corner-shape:superellipse(1.5)) { *,:before,:after{corner-shape:var(--dsw-corner-shape)} }
  // so EVERY rounded element renders as a squircle unless it opts out. The shipped
  // Switch.module.css opts its track and thumb out; a hand-rolled copy that
  // forgets to renders visibly different — which is exactly what happened.
  const css = loadClient().styleTags[0].textContent;
  const optedOut = [...css.matchAll(/\.(dshwst-(?:switch|thumb))\{[^}]*corner-shape:\s*round/gu)].map((m) => m[1]);
  assert.ok(optedOut.includes('dshwst-switch'), 'the track must declare corner-shape: round');
  assert.ok(optedOut.includes('dshwst-thumb'), 'the thumb must declare corner-shape: round');
});

test('the switch geometry matches the shipped primitive exactly', () => {
  const css = loadClient().styleTags[0].textContent;
  const rule = (selector) => {
    const found = css.split(`${selector}{`)[1];
    return found === undefined ? '' : found.split('}')[0];
  };
  const track = rule('.dshwst-switch');
  assert.ok(track.includes('width:36px'), 'the track must be 36px wide');
  assert.ok(track.includes('height:20px'), 'the track must be 20px tall');
  assert.ok(track.includes('border-radius:10px'), 'the track radius must be half its height');
  assert.ok(track.includes('padding:2px'), 'the track must pad 2px');
  const thumb = rule('.dshwst-thumb');
  assert.ok(thumb.includes('width:16px') && thumb.includes('height:16px'), 'the thumb must be 16px');
  assert.ok(thumb.includes('border-radius:50%'), 'the thumb must be a circle');
  assert.ok(css.includes('transform:translateX(16px)'), 'the checked thumb travel must match');
  assert.ok(!track.includes('transition:background'), 'the shipped track has no background transition');
});

test('the wrapper mirrors the shipped cardEnd box', () => {
  const css = loadClient().styleTags[0].textContent;
  const end = css.split('.dshwst-end{')[1].split('}')[0];
  assert.ok(end.includes('display:inline-flex'), 'cardEnd is inline-flex');
  assert.ok(end.includes('position:relative'), 'cardEnd establishes its own position');
  assert.ok(end.includes('z-index:1'), 'cardEnd is lifted, and the switch must sit in the same layer');
  assert.ok(end.includes('flex:none'), 'cardEnd does not grow');
});

test('both locale dictionaries register and cover the same keys', () => {
  const loaded = loadClient();
  assert.deepEqual(loaded.localeRegisters.map((entry) => entry.id).sort(), ['en', 'zh']);
  assert.equal(loaded.localeRegisters[0].ns, 'web-search-toggle');
  const en = loaded.localeRegisters.find((entry) => entry.id === 'en').dict;
  const zh = loaded.localeRegisters.find((entry) => entry.id === 'zh').dict;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('the switch is attached to the OFFICIAL web-search card, as its trailing block', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);

  const head = card.firstElementChild;
  const end = endOf(card);
  assert.ok(end !== null, 'the switch block must be attached to the official card');
  assert.equal(head.children[head.children.length - 1], end, 'it must be the LAST child of the card head, where bundle switches sit');
  assert.equal(end.className, 'dshwst-end');

  const toggle = end.dshwstSwitch;
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute('aria-label'), '网页搜索');
});

test('other cards are left completely alone', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const shell = loaded.makeCard('bash');
  const other = loaded.makeCard('agent-loop');
  loaded.fire([shell]);
  loaded.fire([other]);
  assert.equal(endOf(shell), null, 'only the web-search card is claimed');
  assert.equal(endOf(other), null);
});

test('the card is never restyled — only one block is added', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  const head = card.firstElementChild;
  const before = head.children.length;
  const titleBefore = head.children[1].children[0].children[0];
  loaded.fire([card]);
  assert.equal(head.children.length, before + 1, 'exactly one node is appended');
  assert.equal(head.children[1].children[0].children[0], titleBefore, 'the official title button is untouched');
  assert.equal(card.hasAttribute('data-dshwst-off'), false, 'the card itself is not marked or restyled');
});

test('re-rendering the card does not stack a second switch', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  loaded.fire([card]);
  loaded.fire([card.firstElementChild]);
  const ends = walk(card).filter((node) => node.hasAttribute('data-dshwst-end'));
  assert.equal(ends.length, 1, 'the mount must adopt the block it finds');
});

test('a rebuilt card gets the switch back', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const first = loaded.makeCard('web-search');
  loaded.fire([first]);
  assert.ok(endOf(first) !== null);

  first.remove();
  const second = loaded.makeCard('web-search');
  loaded.fire([second]);
  assert.ok(endOf(second) !== null, 'a replaced card needs its own switch');
});

test('the hot path exits before doing any work', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  assert.equal(loaded.observers.length, 1, 'an observer must actually be created');

  const stray = makeElement('div', loaded.scans);
  let touched = 0;
  stray.querySelector = () => {
    touched += 1;
    return null;
  };
  for (let i = 0; i < 200; i += 1) loaded.fire([stray]);
  assert.equal(touched, 0, 'while the switch is attached the observer must not scan anything');
});

test('an OFF position paints the switch off', async () => {
  const loaded = loadClient({ enabled: false });
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.ok(String(toggle.title).includes('关闭'), 'the title must explain what off means');
});

test('clicking writes through the BOUND SCOPE, never the Remote directly', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;

  const before = loaded.writes.length;
  toggle.click();
  await loaded.settle();

  assert.equal(loaded.writes.length, before + 1);
  assert.deepEqual(loaded.writes[before].field, 'enabled');
  assert.equal(loaded.writes[before].value, false);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(toggle.disabled, false);
});

test('the switch is never disabled while a write is in flight', async () => {
  // Regression: the in-flight state used to set `disabled`, so a write that never
  // settled left a switch that could not be used again — "it turned off and will
  // not turn back on". Re-entrancy is the guard's job, not the DOM attribute's.
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;

  toggle.click();
  assert.equal(toggle.disabled, false, 'a busy switch must stay clickable');
  assert.equal(toggle.hasAttribute('data-dshwst-busy'), true, 'the busy look is cosmetic');
  await loaded.settle();
  assert.equal(toggle.hasAttribute('data-dshwst-busy'), false);
});

test('turning the switch back ON works after turning it OFF', async () => {
  // Regression: the second write reused a revision cached before the first
  // commit, the document's fence refused it, and the optimistic paint reverted —
  // so OFF could never be undone. The bound scope owns the revision now.
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;

  toggle.click();
  await loaded.settle();
  assert.equal(toggle.getAttribute('aria-checked'), 'false', 'first click turns it off');

  toggle.click();
  await loaded.settle();
  assert.equal(toggle.getAttribute('aria-checked'), 'true', 'second click must turn it back on');
  assert.equal(toggle.disabled, false);

  assert.deepEqual(loaded.writes.map((entry) => entry.value), [false, true]);
});

test('the position survives a page reload, because the write landed', async () => {
  // The reported symptom: turn it off, refresh, and it is on again — the write
  // never reached the host. The scope's `set` is the write, so a stubbed store
  // that keeps the value proves the bundle actually committed it.
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  endOf(card).dshwstSwitch.click();
  await loaded.settle();
  assert.equal(loaded.stored(), false, 'the committed value must be OFF, not just painted');

  endOf(card).dshwstSwitch.click();
  await loaded.settle();
  assert.equal(loaded.stored(), true, 'and back ON');
});

test('a refused write reverts and leaves the switch usable', async () => {
  const loaded = loadClient({ updateFails: true });
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;

  toggle.click();
  await loaded.settle();
  assert.equal(toggle.getAttribute('aria-checked'), 'true', 'the host is the authority');
  assert.equal(toggle.disabled, false, 'and the switch stays usable');
});

test('a cold settings mirror is retried when the card mounts', async () => {
  // Regression: a failed boot read used to leave the switch painted disabled
  // forever. Mounting asks again.
  const loaded = loadClient({ coldFirstRead: true });
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  await loaded.settle();
  const toggle = endOf(card).dshwstSwitch;
  assert.equal(toggle.disabled, false, 'the mount must retry the read, not stay dead');
});

test('an external commit repaints the switch', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  const toggle = endOf(card).dshwstSwitch;
  assert.equal(toggle.getAttribute('aria-checked'), 'true');

  await loaded.settle();
  loaded.notifyStore();
  assert.equal(typeof toggle.getAttribute('aria-checked'), 'string');
});

test('unloading the bundle removes the switch it added', async () => {
  const loaded = loadClient();
  await loaded.settle();
  const card = loaded.makeCard('web-search');
  loaded.fire([card]);
  assert.ok(endOf(card) !== null);

  const effect = loaded.cardEffect();
  assert.ok(effect !== undefined);
  effect.dispose();
  assert.equal(loaded.observers[0].disconnected, true, 'the observer must be disconnected');
  assert.equal(endOf(card), null, 'the switch must not outlive the bundle');
});
