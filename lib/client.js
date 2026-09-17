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
 * registers, written through the platform's own settings Remote under the same
 * revision fence every official form uses.
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
     * back. The write is not cancelled — if it lands later the follow-up read
     * adopts whatever it stored.
     */
    const WRITE_TIMEOUT_MS = 8000;

    /** Everything the switch can say, in both locales. */
    const EN = {
      label: 'Web search',
      on: 'Web search is on. Click to turn it off for every agent.',
      off: 'Web search is off. The web_search tool is withheld from every agent; click to turn it back on.',
      busy: 'Applying to the next step…',
      readOnly: 'This deployment stores settings read-only, so the switch cannot be saved.',
      failed: 'The deployment did not accept the new position; the switch was put back.',
    };

    /** Simplified Chinese copy. */
    const ZH = {
      label: '网页搜索',
      on: '网页搜索已开启。点击可为所有 agent 关闭。',
      off: '网页搜索已关闭。所有 agent 都不会获得 web_search 工具；点击可重新开启。',
      busy: '正在应用到下一个模型步…',
      readOnly: '本部署的设置为只读，开关无法保存。',
      failed: '本部署没有接受新的状态，开关已改回。',
    };

    /**
     * The switch's own styles.
     *
     * The track and thumb are copied from the shell's `Switch` primitive (36x20
     * track, 16px thumb, `translate(16px)` when checked, `.16s` transitions), and
     * the wrapper is a flex-none group so it settles at the trailing edge of the
     * card head exactly where an installed bundle card's switch sits. Tokens
     * only, so both themes follow; class names carry the plugin prefix because
     * the whole document shares one namespace.
     */
    const CSS = [
      '.dshwst-end{display:flex;align-items:center;gap:8px;flex:none}',
      '.dshwst-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .16s}',
      '.dshwst-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.dshwst-switch:disabled{cursor:default;opacity:.5}',
      '.dshwst-switch[data-dshwst-busy]{opacity:.5;cursor:default}',
      '.dshwst-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshwst-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}',
      '.dshwst-switch[aria-checked=true] .dshwst-thumb{transform:translate(16px)}',
    ].join('');

    /**
     * The settings Remote face this switch writes through.
     *
     * `describe()` answers every namespace with its resolved value and the
     * revision a write must fence against; `update()` commits a patch. Both are
     * folded into one `{ok:…}` shape so the caller never has to tell a transport
     * fault from a business refusal at the call site.
     *
     * @param ctx - the bundle's Client context.
     * @returns the read and write this switch needs.
     */
    function settingsPort(ctx) {
      const scope = (typeof ctx.get === 'function' ? ctx.get('settingsScope') : undefined)
        ?? ctx.settingsScope
        ?? null;
      const describe = scope !== null && typeof scope.describe === 'function' ? scope.describe() : null;

      /** Read the namespace's section and the revision in force. */
      function read() {
        if (describe === null || typeof describe.getSnapshot !== 'function') return { ok: false };
        try {
          const view = describe.getSnapshot().view;
          const namespaces = view !== null && typeof view === 'object' && Array.isArray(view.namespaces) ? view.namespaces : [];
          const found = namespaces.find((entry) => entry !== null && entry !== undefined && entry.ns === NS);
          if (found === undefined || found === null) return { ok: false };
          return { ok: true, value: { enabled: enabledOf(found.value), revision: found.revision, writable: found.writable } };
        } catch {
          return { ok: false };
        }
      }

      /** Commit one patch, fenced by the revision the caller read. */
      function write(enabled, revision) {
        const remote = ctx.remote;
        const settings = remote === null || remote === undefined ? undefined : remote.settings;
        if (settings === null || settings === undefined || typeof settings.update !== 'function') {
          return Promise.resolve({ ok: false });
        }
        let pending;
        try {
          pending = settings.update(NS, { enabled }, revision);
        } catch {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve(pending).then(
          () => ({ ok: true }),
          () => ({ ok: false }),
        );
      }

      return {
        read,
        write,
        subscribe: describe === null || typeof describe.subscribe !== 'function' ? null : (fn) => describe.subscribe(fn),
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
      toggle.title = ui.known ? ui.t(ui.enabled ? 'on' : 'off') : ui.t('busy');
      toggle.setAttribute('aria-checked', ui.enabled ? 'true' : 'false');
      // The in-flight state is NOT `disabled`. A switch that disables itself
      // while it waits cannot be used again if the write never settles, which
      // reads to the user as "it will not turn back on". Re-entrancy is handled
      // by `flip`'s own guard, so the control stays clickable throughout and the
      // busy look is cosmetic.
      toggle.disabled = !ui.known || ui.readOnly;
      if (ui.busy) toggle.setAttribute('data-dshwst-busy', '');
      else toggle.removeAttribute('data-dshwst-busy');
    }

    /**
     * Attach the switch to the official card, once.
     *
     * The card head is the card's own direct `<div>` child, and this block is
     * appended as its LAST child — the position an installed bundle card gives
     * its `cardEnd` switch. The card itself is never restyled or re-rendered.
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
      if (!ui.known) void refresh(ui);
      return true;
    }

    /** Whether the switch is attached and needs no further work this mutation. */
    function settled(ui) {
      return ui.end !== null && ui.end.isConnected;
    }

    /** In-flight one-shot read, so a burst of mounts issues one request. */
    let refreshing = null;

    /**
     * Read the stored position once.
     *
     * Called at bundle load and never on a timer: the position is a durable fact
     * only this page can change, so polling would buy nothing.
     *
     * @param ui - the shared plugin state.
     * @returns the transport answer.
     */
    function refresh(ui) {
      if (refreshing !== null) return refreshing;
      refreshing = Promise.resolve().then(() => {
        refreshing = null;
        const answer = ui.port.read();
        if (answer.ok) {
          ui.enabled = answer.value.enabled;
          ui.readOnly = answer.value.writable === false;
          // The revision is what fences the write: without it a concurrent edit
          // elsewhere would be overwritten instead of refused.
          ui.revision = answer.value.revision;
          ui.known = true;
        }
        paint(ui);
        return answer;
      });
      return refreshing;
    }

    /**
     * Flip the switch: act on what is stored NOW, then reconcile.
     *
     * The revision is re-read at the START of every flip, and a refusal is
     * retried once against a freshly read revision. Both matter for the same
     * reason: every commit advances the namespace revision, so a revision cached
     * from before the previous commit is refused by the document's own fence —
     * and a refused write reverts the optimistic paint, which reads to the user
     * as "the switch turned off but will not turn back on". The retry turns that
     * ordinary race into a successful second attempt instead of a visible snap
     * back.
     *
     * @param ui - the shared plugin state.
     */
    async function flip(ui) {
      if (ui.busy) return;

      // Never trust a cached position or revision: the store may have moved.
      const before = ui.port.read();
      if (before.ok) {
        ui.enabled = before.value.enabled;
        ui.revision = before.value.revision;
        ui.readOnly = before.value.writable === false;
        ui.known = true;
      }
      if (!ui.known || ui.readOnly) {
        paint(ui);
        return;
      }

      const target = !ui.enabled;
      const previous = ui.enabled;
      ui.enabled = target;
      ui.busy = true;
      paint(ui);

      let settled = false;
      const watchdog = setTimeout(() => {
        if (settled) return;
        ui.busy = false;
        paint(ui);
      }, WRITE_TIMEOUT_MS);

      let answer = await ui.port.write(target, ui.revision);
      if (!answer.ok) {
        const again = ui.port.read();
        if (again.ok) {
          ui.revision = again.value.revision;
          ui.enabled = again.value.enabled;
          // Already where we wanted to be: the write landed despite the refusal,
          // or someone else made the same change.
          answer = again.value.enabled === target ? { ok: true } : await ui.port.write(target, ui.revision);
        }
      }
      settled = true;
      clearTimeout(watchdog);
      ui.busy = false;

      const after = ui.port.read();
      if (after.ok) {
        ui.enabled = after.value.enabled;
        ui.revision = after.value.revision;
        ui.readOnly = after.value.writable === false;
        ui.known = true;
      } else if (!answer.ok) {
        ui.enabled = previous;
      }
      paint(ui);
    }

    /** Required client services: the locale for copy, the settings scope to read. */
    const inject = ['locale', 'settingsScope'];

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

      const ui = {
        end: null,
        enabled: true,
        known: false,
        busy: false,
        readOnly: false,
        revision: undefined,
        port: settingsPort(ctx),
        t: translate,
      };

      // One read at load, deliberately not on a timer: by the time the card can
      // be on screen the stored position is known, so the switch is never painted
      // in one state and corrected into another.
      refresh(ui);

      if (ui.port.subscribe !== null) {
        const off = ui.port.subscribe(() => {
          const answer = ui.port.read();
          if (!answer.ok || ui.busy) return;
          ui.enabled = answer.value.enabled;
          ui.revision = answer.value.revision;
          ui.readOnly = answer.value.writable === false;
          ui.known = true;
          paint(ui);
        });
        if (typeof off === 'function') ctx.effect(() => off, 'dsh-websearch-toggle: settings subscription');
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
