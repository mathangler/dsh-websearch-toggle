/**
 * dsh-websearch-toggle — browser half.
 *
 * NOT an ES module. A DSH client bundle is a classic script registering one
 * lazy-CJS factory on the page-global facade:
 *   window.__ModuleLoader__.load({ id, factory: (require) => exports })
 * `id` must equal the package name.
 *
 * This half adds ONE control to the OFFICIAL "Web search" card on the sidebar
 * Plugins page: a switch at the trailing end of the card's title row, in the
 * same position and style as the switch every installed bundle card already
 * carries. Nothing official is modified — not the card, not its page, not one
 * byte of `@deepseek-ai/dsh-client-ui-plugin-manager`.
 *
 * Why this is DOM work and not a slot. The Plugins page offers exactly three
 * seats (`plugins.item`, `plugins.bundle.config`, `plugins.row.config`), and all
 * three ADD a card or a page; none can put a control INSIDE an existing entry.
 * Worse, `plugins.item`'s own catalog says: "a fresh id is added beside the
 * shipped entries, while reusing a shipped id puts you in THAT cell and replaces
 * it." Reusing `web-search` therefore does not decorate the official card, it
 * evicts it — an earlier build of this package did exactly that and deleted the
 * official Web search form. So the official card is left completely alone and
 * the switch is appended to it after render, then removed when this bundle
 * unloads.
 *
 * The card is found by `li[data-plugin-item="web-search"]` — a stable
 * `data-` attribute the page itself sets — never by a hashed CSS-module class.
 *
 * State lives in the `web-search-toggle` settings namespace the host half
 * registers. Reads and writes both go through the per-namespace settings form —
 * `ctx.configForms.get(namespace)` on 0.1.7, which is the same object every
 * shipped settings form uses (0.1.6 called it `settingsScope.bind({ namespace })`).
 * That matters: the form tracks the namespace revision itself and re-reads after
 * its own writes, so this bundle never has to guess a revision. An earlier build
 * called `ctx.remote.settings.update` directly with a revision it had cached, and
 * the document's fence refused the second write, which left the switch stuck.
 *
 * @module dsh-websearch-toggle/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-websearch-toggle',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** Settings namespace owned by the host half. */
    const NS = 'web-search-toggle';

    /** The official entry this switch is attached to. */
    const ENTRY_ID = 'web-search';

    /** Marker attribute on the block this bundle appends to the official card. */
    const END_ATTR = 'data-dshwst-end';

    /** Backstop delay for re-checking the document for the card. */
    const SWEEP_MS = 400;

    /**
     * How long a write may stay in flight before the switch frees itself.
     *
     * A write that never settles must not leave the control permanently unable to
     * accept a click: the whole point of the switch is that it can always be put
     * back.
     */
    const WRITE_TIMEOUT_MS = 8000;

    /** Everything the switch can say, in both locales. */
    const EN = {
      label: 'Web search',
      on: 'Web search is on. Click to turn it off for every agent.',
      off: 'Web search is off. The web_search tool is withheld from every agent; click to turn it back on.',
      busy: 'Applying to the next step…',
      readOnly: 'This deployment stores settings read-only, so the switch cannot be saved.',
      failed: 'The deployment did not accept the new position. Open the browser console for details.',
    };

    /** Simplified Chinese copy. */
    const ZH = {
      label: '网页搜索',
      on: '网页搜索已开启。点击可为所有 agent 关闭。',
      off: '网页搜索已关闭。所有 agent 都不会获得 web_search 工具；点击可重新开启。',
      busy: '正在应用到下一个模型步…',
      readOnly: '本部署的设置为只读，开关无法保存。',
      failed: '本部署没有接受新的状态。详情请看浏览器控制台。',
    };

    /**
     * The switch's own styles — a verbatim copy of the shipped
     * `@deepseek-ai/dsh-client-ui-primitives` Switch.module.css, plus the wrapper
     * an installed bundle card puts around it.
     *
     * The `corner-shape: round` declarations are load-bearing, not decoration.
     * The theme injects `*,:before,:after{corner-shape:superellipse(1.5)}`
     * globally, so any rounded element that does not opt out renders as a
     * squircle. Omitting them here is exactly why this switch used to look
     * different from every other switch on the page.
     *
     * Class names carry the plugin prefix because the whole document shares one
     * namespace.
     */
    const CSS = [
      // Mirrors the shipped `cardEnd` box, so the switch occupies the same seat
      // — and the same stacking context — as an installed bundle card's switch.
      '.dshwst-end{position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;gap:8px}',
      '.dshwst-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.dshwst-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.dshwst-switch:disabled{cursor:default;opacity:0.5}',
      '.dshwst-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshwst-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
      '.dshwst-switch[aria-checked=true] .dshwst-thumb{transform:translateX(16px)}',
      // This plugin's own state. Cosmetic only; never `display:none`, which
      // would reflow the row.
      '.dshwst-switch[data-dshwst-busy]{opacity:0.5;cursor:default}',
    ].join('');

    /**
     * Resolve the per-namespace settings form this switch reads and writes.
     *
     * DSH 0.1.7 renamed this seam. What used to be
     * `settingsScope.bind({ namespace })` is now `configForms.get(namespace)`,
     * and the SERVICE is `configForms` — 0.1.7 contains no `settingsScope`
     * string anywhere. The returned controller kept the same face
     * (`getSnapshot`, `subscribe`, `set`, `mutate`), so only the access path
     * changes here. The old path is kept as a fallback because it costs one
     * property check and makes this bundle work on either line.
     *
     * `exports.inject` must name a service that exists, or the plugin's fiber
     * waits forever and the page reports the plugin as broken — which is exactly
     * what 0.1.7 did to this plugin while it still injected `settingsScope`.
     *
     * @param ctx - the bundle's Client context.
     * @returns the same snapshot/set/subscribe face either way.
     */
    function resolveForm(ctx) {
      const forms = (typeof ctx.get === 'function' ? ctx.get('configForms') : undefined)
        ?? ctx.configForms
        ?? null;
      if (forms !== null && forms !== undefined && typeof forms.get === 'function') return forms.get(NS);
      const legacy = (typeof ctx.get === 'function' ? ctx.get('settingsScope') : undefined)
        ?? ctx.settingsScope
        ?? null;
      if (legacy !== null && legacy !== undefined && typeof legacy.bind === 'function') return legacy.bind({ namespace: NS });
      return null;
    }

    /**
     * The settings form face this switch reads and writes.
     *
     * Its snapshot carries `status` (`ready` once the mirror holds the
     * namespace), the resolved `value`, and `writable`; its `set(field, value)`
     * queues the write with the revision the form itself is tracking, then
     * re-reads. Nothing here manages a revision, and nothing here touches the
     * Remote directly — that is the point.
     *
     * @param ctx - the bundle's Client context.
     * @returns the read, write and subscribe face this switch needs.
     */
    function settingsPort(ctx) {
      let scope = null;
      try {
        scope = resolveForm(ctx);
      } catch {
        scope = null;
      }

      /** Read the namespace's current form snapshot. */
      function read() {
        if (scope === null || typeof scope.getSnapshot !== 'function') return { ok: false };
        try {
          const snapshot = scope.getSnapshot();
          if (snapshot === null || snapshot === undefined || snapshot.status !== 'ready') return { ok: false };
          return {
            ok: true,
            value: { enabled: enabledOf(snapshot.value), writable: snapshot.writable === true },
          };
        } catch {
          return { ok: false };
        }
      }

      /**
       * Commit one field.
       * @param enabled - the position to store.
       * @returns whether the host accepted it.
       */
      function write(enabled) {
        if (scope === null || typeof scope.set !== 'function') return Promise.resolve(false);
        let pending;
        try {
          pending = scope.set('enabled', enabled);
        } catch {
          return Promise.resolve(false);
        }
        return Promise.resolve(pending).then(() => true, () => false);
      }

      return {
        read,
        write,
        subscribe: scope === null || typeof scope.subscribe !== 'function' ? null : (fn) => scope.subscribe(fn),
      };
    }

    /**
     * Read the switch out of a resolved section.
     * @param section - the namespace's resolved value.
     * @returns the boolean; absent means the shipped default, which is ON.
     */
    function enabledOf(section) {
      if (section === null || section === undefined || typeof section !== 'object') return true;
      return typeof section.enabled === 'boolean' ? section.enabled : true;
    }

    /** The official card this switch belongs to, or null while it is not rendered. */
    function cardIn(root) {
      if (root === null || root === undefined) return null;
      if (root.nodeType === 1 && typeof root.matches === 'function' && root.matches(`li[data-plugin-item="${ENTRY_ID}"]`)) return root;
      if (typeof root.querySelector !== 'function') return null;
      return root.querySelector(`li[data-plugin-item="${ENTRY_ID}"]`);
    }

    /** Build the trailing block: one switch, styled like a bundle card's. */
    function buildEnd(ui) {
      const end = document.createElement('div');
      end.className = 'dshwst-end';
      end.setAttribute(END_ATTR, '');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dshwst-switch';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', 'false');
      toggle.appendChild(document.createElement('span')).className = 'dshwst-thumb';
      toggle.addEventListener('click', () => {
        void flip(ui);
      });

      end.appendChild(toggle);
      end.dshwstSwitch = toggle;
      return end;
    }

    /** Paint the current state onto the injected block. */
    function paint(ui) {
      const end = ui.end;
      if (end === null || !end.isConnected) return;
      const toggle = end.dshwstSwitch;
      const label = ui.t('label');
      toggle.setAttribute('aria-label', label);
      toggle.title = !ui.ready
        ? ui.t('busy')
        : !ui.writable
          ? ui.t('readOnly')
          : ui.failed
            ? ui.t('failed')
            : ui.t(ui.enabled ? 'on' : 'off');
      toggle.setAttribute('aria-checked', ui.enabled ? 'true' : 'false');
      // The in-flight state is NOT `disabled`: a switch that disables itself
      // while it waits cannot be used again if the write never settles, which
      // reads to the user as "it will not turn back on". Re-entrancy is handled
      // by `flip`'s own guard, so the busy look is cosmetic.
      toggle.disabled = !ui.ready || !ui.writable;
      if (ui.busy) toggle.setAttribute('data-dshwst-busy', '');
      else toggle.removeAttribute('data-dshwst-busy');
      // A refusal must be diagnosable from the DOM, not only from a console the
      // user has to think to open.
      if (ui.failed) toggle.setAttribute('data-dshwst-failed', '');
      else toggle.removeAttribute('data-dshwst-failed');
    }

    /**
     * Attach the switch to the official card, once.
     *
     * The card head is the card's own direct `<div>` child, and this block is
     * appended as its LAST child — the position an installed bundle card gives
     * its trailing switch. The card itself is never restyled or re-rendered.
     *
     * @param card - the official `li[data-plugin-item="web-search"]`.
     * @param ui - the shared plugin state.
     * @returns whether the switch is in place.
     */
    function mount(card, ui) {
      if (card === null) return false;
      const head = card.firstElementChild;
      if (head === null || head === undefined) return false;
      let end = head.querySelector(`[${END_ATTR}]`);
      if (end === null) {
        end = buildEnd(ui);
        head.appendChild(end);
      }
      ui.end = end;
      paint(ui);
      // The settings mirror can still be cold when this bundle loads, in which
      // case the boot read failed and the switch would paint disabled. Asking
      // again on mount is what stops it staying dead until a reload.
      if (!ui.ready) refresh(ui);
      return true;
    }

    /** Whether the switch is attached and needs no further work this mutation. */
    function settled(ui) {
      return ui.end !== null && ui.end.isConnected;
    }

    /** Adopt a scope snapshot into the shared state. */
    function adopt(ui, answer) {
      if (!answer.ok) return false;
      ui.enabled = answer.value.enabled;
      ui.writable = answer.value.writable;
      ui.ready = true;
      return true;
    }

    /** In-flight one-shot read, so a burst of mounts issues one request. */
    let refreshing = null;

    /**
     * Read the stored position once.
     *
     * Called at bundle load and whenever the card mounts cold — never on a timer.
     *
     * @param ui - the shared plugin state.
     * @returns the read answer.
     */
    function refresh(ui) {
      if (refreshing !== null) return refreshing;
      refreshing = Promise.resolve().then(() => {
        refreshing = null;
        const answer = ui.port.read();
        adopt(ui, answer);
        paint(ui);
        return answer;
      });
      return refreshing;
    }

    /**
     * Flip the switch: optimistic, then reconciled against the scope.
     *
     * The bound scope owns the revision fence and re-reads after each write, so
     * there is no cached revision to go stale between two clicks — which is what
     * previously made the second click get refused and snap back.
     *
     * @param ui - the shared plugin state.
     */
    async function flip(ui) {
      if (ui.busy || !ui.ready || !ui.writable) return;

      const target = !ui.enabled;
      ui.enabled = target;
      ui.busy = true;
      ui.failed = false;
      paint(ui);

      let settledFlag = false;
      const watchdog = setTimeout(() => {
        if (settledFlag) return;
        ui.busy = false;
        paint(ui);
      }, WRITE_TIMEOUT_MS);

      const accepted = await ui.port.write(target);
      settledFlag = true;
      clearTimeout(watchdog);
      ui.busy = false;

      // The scope re-reads after its own writes, so take the truth from it
      // rather than from the optimistic paint.
      ui.failed = !accepted && !adopt(ui, ui.port.read());
      if (ui.failed) ui.enabled = !target;
      else adopt(ui, ui.port.read());
      paint(ui);
    }

    /**
     * Required client services.
     *
     * `configForms` is what 0.1.7 provides for per-namespace settings access;
     * `locale` supplies the copy. Both must be services that actually exist —
     * naming one that does not leaves this plugin's fiber waiting forever, and
     * the page then reports the plugin as broken.
     */
    const inject = ['locale', 'configForms'];

    /**
     * Client plugin body: inject the stylesheet, resolve copy, read the stored
     * position, and keep the switch attached to the official card for as long as
     * this bundle is loaded.
     * @param ctx - Client Cordis context.
     */
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
          // 0.1.7's `register(ns, localeOrDicts, dict)` accepts either a single
          // `(ns, localeId, dict)` triple or one `(ns, { localeId: dict })` map,
          // and THROWS when a namespace already has that locale — which happens
          // on an HMR reload of this bundle. Each registration is guarded on its
          // own so one refusal cannot cost the other locale.
          try {
            const off = locale.register(NS, id, pickDict(id));
            if (typeof off === 'function') ctx.effect(() => off, 'dsh-websearch-toggle: locale dictionary');
          } catch {
            // Already registered on this page; the bound lookup below still works.
          }
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

      const ui = {
        end: null,
        enabled: true,
        ready: false,
        writable: false,
        busy: false,
        failed: false,
        port: settingsPort(ctx),
        t: translate,
      };

      // One read at load, deliberately not on a timer: by the time the card can
      // be on screen the stored position is known, so the switch is never painted
      // in one state and corrected into another.
      refresh(ui);

      if (ui.port.subscribe !== null) {
        const off = ui.port.subscribe(() => {
          if (ui.busy) return;
          adopt(ui, ui.port.read());
          paint(ui);
        });
        if (typeof off === 'function') ctx.effect(() => off, 'dsh-websearch-toggle: scope subscription');
      }

      // The Plugins page mounts when the user opens it and unmounts on close, and
      // it re-renders its card list on every store change, so the switch has to be
      // re-attached whenever the card appears rather than once at load.
      //
      // A MutationObserver callback already runs as a microtask at the end of
      // React's commit — after the nodes are in the DOM, before the frame is
      // painted — so the switch lands in the same frame the card does. The cost
      // of being that hot is bounded two ways: the callback returns immediately
      // while the switch is attached, and it inspects only the nodes just added.
      ctx.effect(() => {
        mount(cardIn(document), ui);
        if (typeof MutationObserver !== 'function' || !document.body) return () => {};

        let sweep = 0;
        const backstop = () => {
          if (sweep !== 0) return;
          sweep = setTimeout(() => {
            sweep = 0;
            if (settled(ui)) return;
            mount(cardIn(document), ui);
          }, SWEEP_MS);
        };

        const observer = new MutationObserver((records) => {
          if (settled(ui)) return;
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (mount(cardIn(node), ui)) return;
            }
          }
          backstop();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
          observer.disconnect();
          if (sweep !== 0) clearTimeout(sweep);
          // Leaving the switch behind would outlive this bundle.
          if (ui.end !== null && ui.end.isConnected) ui.end.remove();
          ui.end = null;
        };
      }, 'dsh-websearch-toggle: web search switch');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__test = { CSS, EN, ZH, NS, ENTRY_ID, END_ATTR, enabledOf, settingsPort, cardIn, buildEnd, mount, settled, paint, flip, refresh };
    return module.exports;
  },
});
