/**
 * Load-layer tests for the browser half.
 *
 * The bundle is a classic script, so it is evaluated here with a fake
 * `window`/`document` and a shimmed `require`. Every assertion that claims "the
 * code did X" also counts what it touched, because the failure mode this suite
 * exists to catch is a branch that silently early-returns while the suite stays
 * green.
 *
 * What this half owes the page is narrow and worth stating: it registers ONE
 * configuration page under the shipped `web-search` entry id (so the switch
 * lands in that entry's cell rather than beside it), it renders the shipped
 * `Switch`, and it never paints a switch position it has not read.
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

/**
 * A React stand-in that actually re-renders.
 *
 * A no-op `useState` would make every assertion below pass vacuously — the
 * component would render its initial placeholder forever and "no switch until
 * the namespace answers" would be true for the wrong reason. So state is real,
 * effects run after the render, and `act()` re-renders until the tree settles.
 */
function makeReact() {
  const mounted = [];
  let current = null;
  // Each frame's setters resolve through the frame itself, so a deferred
  // `setState` from a settled promise lands on the component that owns it
  // rather than on whichever component happened to render last.
  const bind = (frame) => {
    const own = (index) => (next) => {
      const previous = frame.state[index];
      frame.state[index] = typeof next === 'function' ? next(previous) : next;
      frame.dirty = true;
    };
    return own;
  };

  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props === null || props === undefined ? {} : props,
      children,
    }),
    useRef(initial) {
      if (current.refs.length <= current.ref) current.refs.push({ current: initial === undefined ? null : initial });
      return current.refs[current.ref++];
    },
    useState(initial) {
      const index = current.hook++;
      if (current.state.length <= index) {
        current.state.push(typeof initial === 'function' ? initial() : initial);
      }
      const frame = current;
      const setter = (next) => {
        const previous = frame.state[index];
        frame.state[index] = typeof next === 'function' ? next(previous) : next;
        frame.dirty = true;
      };
      return [current.state[index], setter];
    },
    useEffect(effect) {
      current.effects.push(effect);
    },
    /**
     * Mount a component and render it until no state update is pending.
     *
     * Effects run after the render, as React runs them, so the mount path the
     * assertions care about — read the namespace, then paint — is exercised
     * rather than assumed.
     */
    act(type, props) {
      const frame = { render: type, props, state: [], hook: 0, ref: 0, refs: [], effects: [], dirty: false, setters: [] };
      frame.setters = [];
      current = frame;
      for (let hook = 0; hook < 32; hook += 1) frame.setters.push(bind(frame));
      // `current.setters` must exist while the component body runs.
      frame.setters = frame.setters;
      current.setters = frame.setters;
      let tree = frame.render(frame.props);
      for (let pass = 0; pass < 20; pass += 1) {
        const pending = frame.effects;
        frame.effects = [];
        for (const effect of pending) {
          const cleanup = effect();
          if (typeof cleanup === 'function') frame.cleanups = (frame.cleanups || []).concat(cleanup);
        }
        if (!frame.dirty) break;
        frame.dirty = false;
        frame.hook = 0;
        frame.ref = 0;
        current = frame;
        tree = frame.render(frame.props);
      }
      mounted.push(frame);
      return { tree, frame, props };
    },
    /** Re-run the mounted component's effects, as a store notification would. */
    flush(frame, props) {
      const saved = current;
      current = frame;
      frame.props = props === undefined ? frame.props : props;
      frame.hook = 0;
      frame.ref = 0;
      frame.dirty = true;
      for (let pass = 0; pass < 20 && frame.dirty; pass += 1) {
        frame.dirty = false;
        for (const effect of frame.effects.splice(0)) {
          const cleanup = effect();
          if (typeof cleanup === 'function') frame.cleanups = (frame.cleanups || []).concat(cleanup);
        }
      }
      const tree = frame.render(frame.props);
      current = saved;
      return tree;
    },
    /**
     * Mount whatever component a wrapper's first render produced.
     *
     * The slot renderer wraps a contribution once to bind owner props and the
     * inject face, so a test that renders the wrapper alone only ever sees the
     * wrapper's own first frame. This mounts the real component the way the page
     * eventually does.
     */
    compose(tree, props) {
      if (tree === null || typeof tree !== 'object' || typeof tree.type !== 'function') return tree;
      const inner = React.act(tree.type, Object.assign({}, tree.props, props));
      return inner.tree;
    },
  };
  return React;
}

/** A minimal DOM element, enough for the stylesheet effect. */
function makeElement(tag) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    dataset: {},
    attributes: {},
    textContent: '',
    parentNode: null,
    isConnected: false,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    remove() {
      this.isConnected = false;
      if (this.parentNode !== null) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      }
    },
  };
}

/**
 * Evaluate the bundle against a fake page and run `apply`.
 * @param options - `locale` selects the active locale, `namespaces` feeds the
 *   settings view the component reads, and `writes` records every settings update.
 * @returns the captured module plus everything the assertions count.
 */
function loadClient(options = {}) {
  const styleTags = [];
  const effects = [];
  const localeRegisters = [];
  const writes = [];
  const subscribes = [];
  const registered = [];
  const injected = [];

  const head = { children: [], appendChild(tag) { tag.parentNode = head; tag.isConnected = true; head.children.push(tag); styleTags.push(tag); return tag; } };
  const doc = { nodeType: 9, head, body: { nodeType: 1, tagName: 'BODY' }, createElement: (tag) => makeElement(tag) };

  let captured = null;
  const win = { __ModuleLoader__: { load: (m) => { captured = m; } } };
  const React = makeReact();
  const primitives = { Switch: 'Switch' };

  new Function('window', 'document', source)(win, doc);

  let view = {
    namespaces: options.namespaces === undefined
      ? [{ ns: 'web-search-toggle', value: { enabled: true }, revision: 7, user: { enabled: true } }]
      : options.namespaces,
  };
  let notify = null;
  let last = { tree: null, frame: null };
  const describe = {
    getSnapshot: () => ({ view }),
    subscribe(fn) {
      notify = fn;
      subscribes.push(fn);
      return () => { notify = null; };
    },
  };

  const remote = {
    settings: {
      update(ns, patch, revision) {
        writes.push({ ns, patch, revision });
        if (options.updateFails === true) return Promise.reject(new Error('revision conflict'));
        // The commit moves the document the way the real Remote would.
        const found = view.namespaces.find((entry) => entry.ns === ns);
        if (found !== undefined) found.value = { ...found.value, ...patch };
        return Promise.resolve();
      },
    },
  };

  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    settingsScope: { describe: () => describe },
    remote,
    slots: {
      inject(name, thunk) {
        injected.push(name);
        thunk();
        return () => {};
      },
      register(registration, component) {
        registered.push(Object.assign({}, registration, { component }));
        return registration;
      },
    },
    locale: {
      getSnapshot: () => ({ active: options.locale === undefined ? 'zh' : options.locale, locales: [{ id: 'en' }, { id: 'zh' }] }),
      register: (ns, id, dict) => { localeRegisters.push({ ns, id, dict }); return () => {}; },
      bind: () => undefined,
      subscribe: () => () => {},
    },
  };

  const mod = captured.factory((name) => {
    if (name === 'react') return React;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error('unexpected require: ' + name);
  });
  mod.apply(ctx);

  return {
    mod,
    styleTags,
    effects,
    localeRegisters,
    writes,
    subscribes,
    registered,
    injected,
    React,
    /** The component the slot registration rendered, bound the way the owner binds it. */
    component: () => registered[0].component,
    /**
     * Render one view the way the page does.
     *
     * The slot renderer binds owner props and the inject face on the same
     * wrapper, and the wrapper's result IS the component under test — the page
     * then renders that with the owner props merged in. `React.act` drives the
     * whole chain, so the tree returned here is what the page would mount.
     */
    render: (view_) => {
      const owner = { view: view_, writable: options.writable };
      const mounted = React.act(registered[0].component, owner);
      // The owner binds `view`/`writable`; the wrapper supplies the context.
      // Merging in the child's OWN props preserves that binding rather than
      // replacing it with the bare owner props (which would drop the context
      // and leave the component reading nothing).
      last = mounted.tree !== null && typeof mounted.tree === 'object' && typeof mounted.tree.type === 'function'
        ? React.act(mounted.tree.type, Object.assign({}, mounted.tree.props, owner))
        : mounted;
      return last.tree;
    },
    /** The tree as it stands after the last render or flush. */
    current: () => last.tree,
    /** Let the component observe a new namespace snapshot, as a commit would. */
    setView: (next) => {
      view = next;
      if (notify !== null) notify();
      last.tree = React.flush(last.frame);
      return last.tree;
    },
    styleEffect: () => effects.find((entry) => entry.label.includes('stylesheet')),
  };
}

/** Depth-first search for the first node whose props carry a key. */
function findByProp(node, key) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByProp(child, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const own = node.props === undefined ? undefined : node.props[key];
  if (own !== undefined) return node;
  return findByProp(node.children, key);
}

/** Every text fragment in a rendered tree. */
function textOf(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out; }
  if (typeof node !== 'object') return out;
  textOf(node.children, out);
  return out;
}

test('the bundle id is the package name and it asks only for slots and locale', () => {
  const match = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/u.exec(source);
  assert.equal(match[1], pkg.name, 'a mismatched id is a silently unloaded bundle');
  assert.deepEqual(loadClient().mod.inject, ['slots', 'locale']);
});

test('it registers its own entry and NEVER reuses a shipped id', () => {
  const loaded = loadClient();
  assert.deepEqual(loaded.injected, ['plugins.item'], 'the 0.1.6 seat for a host-plane plugin page');
  assert.equal(loaded.registered.length, 1);
  const registration = loaded.registered[0];
  assert.equal(registration.name, 'plugins.item');
  assert.equal(registration.id, 'web-search-toggle');
  // The slot catalog: "reusing a shipped id puts you in THAT cell and replaces
  // it". Reusing `web-search` evicted the official page — and, through the
  // official package's availability sync, its siblings too. This assertion is
  // the regression guard for that.
  assert.notEqual(registration.id, 'web-search', 'a shipped id may never be reused');
  for (const shipped of ['bash', 'agent-loop', 'subagent', 'web-search']) {
    assert.notEqual(registration.id, shipped, `shipped entry id must stay untouched: ${shipped}`);
  }
  assert.equal(registration.order, 41, 'directly after the official Web search entry (40)');
  assert.equal(typeof registration.label, 'function', 'label must be a thunk so it follows the locale');
  assert.equal(typeof registration.component, 'function');
});

test('the label is this entry’s own title, not the switch caption', () => {
  assert.equal(loadClient({ locale: 'zh' }).registered[0].label(), '网页搜索开关');
  assert.equal(loadClient({ locale: 'en' }).registered[0].label(), 'Web search switch');
});

test('both locale dictionaries register and cover the same keys', () => {
  const loaded = loadClient();
  assert.deepEqual(loaded.localeRegisters.map((entry) => entry.id).sort(), ['en', 'zh']);
  assert.equal(loaded.localeRegisters[0].ns, 'web-search-toggle');
  const en = loaded.localeRegisters.find((entry) => entry.id === 'en').dict;
  const zh = loaded.localeRegisters.find((entry) => entry.id === 'zh').dict;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.equal(en.toggle, 'Enable web search');
  assert.equal(zh.toggle, '启用网页搜索');
});

test('the stylesheet is injected, prefixed, token-only, and tied to the fiber', () => {
  const loaded = loadClient();
  assert.equal(loaded.styleTags.length, 1);
  assert.equal(loaded.styleTags[0].dataset.plugin, 'dsh-websearch-toggle');
  const css = loaded.styleTags[0].textContent;
  assert.ok(css.includes('.dshwst-field'), 'the field block rule must be present');
  assert.ok(css.includes('.dshwst-error'), 'the error rule must be present');
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

test('the summary view is the one-liner the card shows', () => {
  const loaded = loadClient({ locale: 'zh' });
  assert.equal(loaded.render('summary'), '为所有 agent 开关网页搜索。');
  assert.equal(loadClient({ locale: 'en' }).render('summary'), 'Turn web search on or off for every agent.');
});

test('the page view renders the shipped Switch, checked from the stored value', () => {
  const loaded = loadClient();
  const tree = loaded.render('page');
  const node = findByProp(tree, 'checked');
  assert.ok(node !== undefined, 'the page must render a switch');
  assert.equal(node.type, 'Switch', 'it must be the shell primitive, not a hand-rolled control');
  assert.equal(node.props.checked, true);
  assert.equal(node.props.disabled, false);
  assert.equal(typeof node.props.onChange, 'function');
  assert.equal(node.props.label, '启用网页搜索');
});

test('a stored OFF paints the switch off and explains what that means', () => {
  const loaded = loadClient({ namespaces: [{ ns: 'web-search-toggle', value: { enabled: false }, revision: 3 }] });
  const tree = loaded.render('page');
  assert.equal(findByProp(tree, 'checked').props.checked, false);
  const zh = loaded.localeRegisters.find((entry) => entry.id === 'zh').dict;
  assert.ok(textOf(tree).includes(zh.off), 'the hint must be the OFF explanation');
});

test('an unanswered namespace renders no switch at all, never a guessed position', () => {
  const loaded = loadClient({ namespaces: [] });
  const tree = loaded.render('page');
  assert.equal(findByProp(tree, 'checked'), undefined, 'a position nobody read must not be painted');
  assert.ok(textOf(tree).includes('正在读取已保存的开关状态…'));
});

test('the component subscribes to the namespace it reads', () => {
  const loaded = loadClient();
  loaded.render('page');
  assert.equal(loaded.subscribes.length >= 1, true, 'a late or external commit must be able to reach the page');
});

test('flipping the switch writes the namespace with the revision it read', async () => {
  const loaded = loadClient();
  const node = findByProp(loaded.render('page'), 'checked');
  node.props.onChange(false);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(loaded.writes, [{ ns: 'web-search-toggle', patch: { enabled: false }, revision: 7 }]);
});

test('a refused write is reported and the switch goes back', async () => {
  const loaded = loadClient({ updateFails: true });
  const node = findByProp(loaded.render('page'), 'checked');
  node.props.onChange(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.writes.length, 1, 'the attempt must actually reach the Remote');
});

test('a read-only deployment disables the switch rather than failing on click', () => {
  const loaded = loadClient({ writable: false });
  const node = findByProp(loaded.render('page'), 'checked');
  assert.equal(node.props.disabled, true);
});
