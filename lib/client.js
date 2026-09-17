/**
 * dsh-websearch-toggle — browser half.
 *
 * NOT an ES module. A DSH client bundle is a classic script registering one
 * lazy-CJS factory on the page-global facade:
 *   window.__ModuleLoader__.load({ id, factory: (require) => exports })
 * `id` must equal the package name.
 *
 * This half registers the Web search entry's configuration page. Since DSH
 * 0.1.6 the official plugin pages live on the sidebar **Plugins** page, declared
 * through three slots: `plugins.item` (a host-plane configuration page, listed
 * in the Official group), `plugins.bundle.config`, and `plugins.row.config`. The
 * page asks every entry for two views through its owner props:
 *
 *   view: 'summary' — the one-liner under the card
 *   view: 'page'    — the body of the entry's own page, with its own controls
 *
 * Registering under the SHIPPED id `web-search` puts this component in that
 * entry's existing cell: the "网页搜索" card keeps its title and its key /
 * endpoint / max-uses form, and gains a switch at the top of its page — the same
 * shape the Subagent entry already has, where a permission switch sits above the
 * controls it governs. That is why this half is a slot registration rather than
 * the DOM injection the 0.1.5 build needed: the page now has a seat for it.
 *
 * State rides the platform's own settings Remote over the `web-search-toggle`
 * namespace the Host half registers. The namespace is written with the revision
 * fence the page's own forms use, so a write that raced another window is
 * refused rather than silently overwriting it.
 *
 * @module dsh-websearch-toggle/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-websearch-toggle',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const h = React.createElement;
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    /** Settings namespace owned by the host half. */
    const NS = 'web-search-toggle';

    /**
     * This entry's OWN id on the Plugins page.
     *
     * Deliberately not the shipped `web-search`: that id belongs to the official
     * DeepSeek search page, and reusing it replaces that page instead of adding
     * to it.
     */
    const ENTRY_ID = 'web-search-toggle';

    /** Rendered directly after the official Web search entry, whose order is 40. */
    const ENTRY_ORDER = 41;

    /** Everything the switch can say, in both locales. */
    const EN = {
      pageTitle: 'Web search switch',
      summary: 'Turn web search on or off for every agent.',
      toggle: 'Enable web search',
      on: 'Agents may search the web with the DeepSeek search provider. Every search is a billed model request.',
      off: 'Agents get no web_search tool and nothing is sent to the search provider. The endpoint and key on the official Web search page are kept but ignored.',
      applying: 'Applying to the next step…',
      unknown: 'Reading the saved switch position…',
      readOnly: 'This deployment stores settings read-only, so the switch cannot be saved.',
      loadFailed: 'Could not read the saved switch position.',
      saveFailed: 'The deployment did not accept the new position; the switch was put back.',
    };

    /** Simplified Chinese copy. */
    const ZH = {
      pageTitle: '网页搜索开关',
      summary: '为所有 agent 开关网页搜索。',
      toggle: '启用网页搜索',
      on: 'Agent 可以调用 DeepSeek 搜索提供方联网搜索；每次搜索都是一次计费的模型请求。',
      off: 'Agent 不会获得 web_search 工具，也不会有任何请求发往搜索提供方；官方「网页搜索」页面上的接口地址与密钥会保留但不再生效。',
      applying: '正在应用到下一个模型步…',
      unknown: '正在读取已保存的开关状态…',
      readOnly: '本部署的设置为只读，开关无法保存。',
      loadFailed: '无法读取已保存的开关状态。',
      saveFailed: '本部署没有接受新的状态，开关已改回。',
    };

    /**
     * The page's own field rhythm, copied from the shipped cards so this block
     * reads as one more part of the entry rather than a foreign panel: a 12px
     * stack, the card's `.5px` divider, and a hint in tertiary text. Class names
     * carry the plugin prefix because the whole document shares one namespace.
     */
    const CSS = [
      '.dshwst-field{display:flex;flex-direction:column;gap:6px;padding-bottom:12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshwst-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;color:var(--dsw-alias-label-primary)}',
      '.dshwst-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5}',
      '.dshwst-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.dshwst-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}',
    ].join('');

    /**
     * One call into the settings Remote.
     *
     * `describe()` answers every namespace with its resolved value, its raw user
     * layer and the revision a write must fence against; `update()` commits a
     * patch. Both reject as business results, folded here into the single
     * `{ok:…}` shape the component speaks.
     *
     * @param ctx - the entry plugin's Client context.
     * @returns the read and write this component needs.
     */
    function settingsPort(ctx) {
      const scope = typeof ctx.settingsScope === 'object' && ctx.settingsScope !== null
        ? ctx.settingsScope
        : null;
      const describe = scope !== null && typeof scope.describe === 'function' ? scope.describe() : null;

      /** Read the namespace's section and the revision in force. */
      function read() {
        if (describe !== null && typeof describe.getSnapshot === 'function') {
          try {
            const view = describe.getSnapshot().view;
            const namespaces = view !== null && typeof view === 'object' && Array.isArray(view.namespaces) ? view.namespaces : [];
            const found = namespaces.find((entry) => entry !== null && entry !== undefined && entry.ns === NS);
            if (found !== undefined && found !== null) {
              return { ok: true, value: { section: found.value, revision: found.revision } };
            }
            return { ok: false, error: 'unavailable' };
          } catch (error) {
            return { ok: false, error: String(error && error.message ? error.message : error) };
          }
        }
        return { ok: false, error: 'unavailable' };
      }

      /** Commit one patch, fenced by the revision the caller read. */
      function write(enabled, revision) {
        const remote = ctx.remote;
        const settings = remote === null || remote === undefined ? undefined : remote.settings;
        if (settings === null || settings === undefined || typeof settings.update !== 'function') {
          return Promise.resolve({ ok: false, error: 'unavailable' });
        }
        let pending;
        try {
          pending = settings.update(NS, { enabled }, revision);
        } catch (error) {
          return Promise.resolve({ ok: false, error: String(error && error.message ? error.message : error) });
        }
        return Promise.resolve(pending).then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error: String(error && error.message ? error.message : error) }),
        );
      }

      return { read, write, subscribe: describe === null || typeof describe.subscribe !== 'function' ? null : (fn) => describe.subscribe(fn) };
    }

    /**
     * Read the switch's state out of whatever the namespace resolved to.
     * @param section - the namespace's resolved value.
     * @returns the boolean, or undefined while it cannot be read.
     */
    function enabledOf(section) {
      if (section === null || section === undefined || typeof section !== 'object') return undefined;
      return typeof section.enabled === 'boolean' ? section.enabled : true;
    }

    /**
     * The Web search entry's configuration page.
     *
     * The component renders a placeholder — never a switch position it cannot
     * back up — until the namespace has answered. That is the one rendering rule
     * this family of plugins has actually shipped a bug against: never paint a
     * wrong state and correct it a frame later.
     *
     * `ctx` arrives on `__dshwst` rather than being closed over: the slot
     * renderer owns the props it binds, and hiding the context under an
     * unlikely key keeps it out of the way of any prop the owner adds later.
     */
    function WebSearchToggle(props) {
      const { t, view } = props;
      const port = React.useRef(null);
      if (port.current === null) port.current = settingsPort(props.__dshwst);

      // The switch is drawn ON until the namespace answers, but `ready` gates
      // rendering, so that default is never shown.
      const [state, setState] = React.useState({
        ready: false,
        enabled: true,
        revision: undefined,
        busy: false,
        error: '',
      });

      // The namespace can arrive late (its owner registers after this bundle)
      // and can change under the page — another window, or the same document
      // written elsewhere — so the subscription re-reads rather than trusting
      // the value it mounted with.
      React.useEffect(() => {
        let alive = true;
        const sync = () => {
          if (!alive) return;
          const answer = port.current.read();
          if (!answer.ok) return;
          setState((previous) => Object.assign({}, previous, {
            ready: true,
            enabled: enabledOf(answer.value.section) === true,
            revision: answer.value.revision,
            error: '',
          }));
        };
        sync();
        const off = port.current.subscribe === null ? null : port.current.subscribe(sync);
        if (typeof off !== 'function') return () => { alive = false; };
        return () => {
          alive = false;
          off();
        };
      }, []);

      if (view === 'summary') return t('summary');

      if (!state.ready) {
        return h('div', { className: 'dshwst-field' },
          h('p', { className: state.error === '' ? 'dshwst-hint' : 'dshwst-error', role: 'status' },
            state.error === '' ? t('unknown') : state.error));
      }

      /** Flip the switch optimistically, then reconcile with what the host stored. */
      const onChange = (next) => {
        const previous = state.enabled;
        const revision = state.revision;
        setState((current) => Object.assign({}, current, { enabled: next, busy: true, error: '' }));
        Promise.resolve(port.current.write(next, revision)).then((answer) => {
          const reread = port.current.read();
          setState((current) => {
            if (!answer.ok) {
              return Object.assign({}, current, { enabled: previous, busy: false, error: t('saveFailed') });
            }
            return Object.assign({}, current, {
              enabled: reread.ok ? enabledOf(reread.value.section) === true : next,
              revision: reread.ok ? reread.value.revision : revision,
              busy: false,
              error: '',
            });
          });
        });
      };

      const label = t('toggle');
      return h('div', { className: 'dshwst-field', 'data-dshwst-field': '' },
        h('div', { className: 'dshwst-row' },
          h('span', { className: 'dshwst-label' }, label),
          h(primitives.Switch, {
            checked: state.enabled,
            label,
            disabled: state.busy || props.writable === false,
            onChange,
          }),
        ),
        h('p', { className: state.error === '' ? 'dshwst-hint' : 'dshwst-error', role: 'status' },
          state.error !== '' ? state.error : t(state.enabled ? 'on' : 'off')),
        state.busy ? h('p', { className: 'dshwst-hint', role: 'status' }, t('applying')) : null,
      );
    }

    /** Styles and locale follow the fiber, so a stopped plugin leaves nothing behind. */
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-websearch-toggle';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'dsh-websearch-toggle: switch stylesheet');

      const locale = ctx.locale;
      const pickDict = (id) => (/^zh/i.test(String(id || '')) ? ZH : EN);
      const activeId = () => {
        try {
          const snapshot = locale.getSnapshot();
          return String((snapshot && snapshot.active) || '');
        } catch {
          return '';
        }
      };

      let bound = null;
      try {
        let ids = [];
        try {
          const snapshot = locale.getSnapshot();
          ids = Array.isArray(snapshot && snapshot.locales) ? snapshot.locales.map((d) => String(d.id)) : [];
        } catch {
          // Fall back to the known pair.
        }
        if (ids.length === 0) ids = ['en', 'zh'];
        for (const id of ids) {
          const off = locale.register(NS, id, pickDict(id));
          if (typeof off === 'function') ctx.effect(() => off, 'dsh-websearch-toggle: locale dictionary');
        }
        bound = typeof locale.bind === 'function' ? locale.bind(NS) : null;
      } catch {
        bound = null;
      }

      const translate = (key) => {
        if (bound !== null) {
          try {
            const value = bound(key);
            if (typeof value === 'string' && value !== key && value.length > 0) return value;
          } catch {
            // Fall through to the literal dictionary.
          }
        }
        const dict = pickDict(activeId());
        return dict[key] || EN[key] || key;
      };

      const Component = (props) => h(WebSearchToggle, Object.assign({}, props, { t: translate, __dshwst: ctx }));

      // An id of its OWN. The slot catalog is explicit about what reusing a
      // shipped id does: "a fresh id is added beside the shipped entries, while
      // reusing a shipped id puts you in THAT cell and replaces it." Registering
      // under `web-search` therefore does not add a control to the official page
      // — it evicts that page, which is exactly the bug that removed the shipped
      // Web search form (and, through the official package's own availability
      // sync, the other official entries with it).
      //
      // `order: 41` puts this directly after the official Web search entry
      // (40), so the two read as one group. Nothing official is touched: the
      // shipped page keeps its id, its title and its fields, and this adds a
      // second entry beside it.
      ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: ENTRY_ID,
        order: ENTRY_ORDER,
        label: () => translate('pageTitle'),
        locale: NS,
        inject: () => ({}),
      }, Component));
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];
    exports.__test = { CSS, EN, ZH, NS, ENTRY_ID, ENTRY_ORDER, enabledOf, settingsPort, WebSearchToggle };
    return module.exports;
  },
});
