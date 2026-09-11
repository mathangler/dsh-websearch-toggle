/**
 * dsh-websearch-toggle — browser half.
 *
 * NOT an ES module. A DSH client bundle is a classic script registering one
 * lazy-CJS factory on the page-global facade:
 *   window.__ModuleLoader__.load({ id, factory: (require) => exports })
 * `id` must equal the package name. `require` is unused here: the whole half is
 * plain DOM work, because the switch it adds has to live INSIDE a card this
 * package does not own.
 *
 * Why the DOM and not a slot. The Plugins section renders one card per settings
 * namespace through `settings.plugin.item`, keyed by that namespace, and the
 * "网页搜索" card belongs to `@deepseek-ai/dsh-client-ui-settings-plugins`. A
 * second registration under the same `web-search-deepseek` key would render a
 * SECOND card beside it, not a control inside it, and the shipped card's React
 * tree is not reachable from another bundle. So the switch is injected into the
 * card's expanded body — the same post-render technique this family of plugins
 * already uses for settings nav glyphs — and React tolerates it for the reason
 * it tolerates any foreign child: it only rewrites the nodes and attributes it
 * rendered itself.
 *
 * Placement is deliberate and matches the request that produced this plugin:
 * the switch is the FIRST child of the card's body, so it is visible only after
 * the card is expanded, never on the collapsed header.
 *
 * @module dsh-websearch-toggle/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-websearch-toggle',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    /** Route prefix owned by the host half; must match lib/index.js. */
    const CHANNEL = '/websearch-toggle';

    /** Locale namespace for this plugin's dictionary. */
    const NS = 'dsh-websearch-toggle';

    /** Marker on the card we patched, so both the CSS and the observer can find it. */
    const CARD_ATTR = 'data-dshwst-card';

    /** Marker on a card whose switch is OFF; every grey rule hangs off it. */
    const OFF_ATTR = 'data-dshwst-off';

    /** Marker on the row we injected. */
    const ROW_ATTR = 'data-dshwst-row';

    /**
     * Backstop delay for re-checking the whole document.
     *
     * The row is normally injected synchronously from the very mutation that
     * inserted the card body (see the observer in `apply`), which is what keeps
     * the switch from appearing one frame late. This timer only covers a card
     * that somehow arrives outside the subtree a mutation showed us, so it can
     * afford to be slow.
     */
    const SWEEP_MS = 400;

    /**
     * The shipped card's own title, in every shipped locale.
     *
     * The nav row and this card both carry no id on their rendered nodes, so the
     * label text is the only stable handle. Matching both spellings keeps the
     * switch mounted across a language switch instead of dropping it.
     */
    const CARD_TITLES = ['网页搜索', 'Web search'];

    /** Everything this row can say, in both locales. */
    const EN = {
      toggle: 'Enable web search',
      on: 'Agents may search the web with the DeepSeek search provider. Every search is a billed model request.',
      off: 'Agents get no web_search tool and nothing is sent to the search provider. The endpoint and key below are kept but ignored.',
      unknown: 'Reading the saved switch position…',
    };

    /** Simplified Chinese copy. */
    const ZH = {
      toggle: '启用网页搜索',
      on: 'Agent 可以调用 DeepSeek 搜索提供方联网搜索；每次搜索都是一次计费的模型请求。',
      off: 'Agent 不会获得 web_search 工具，也不会有任何请求发往搜索提供方；下方的接口地址与密钥会保留但不再生效。',
      unknown: '正在读取已保存的开关状态…',
    };

    /**
     * The row's stylesheet.
     *
     * Sizes and colours are copied from the shell's own controls rather than
     * invented: the toggle is the shell's `Switch` (36x20 track, 16px thumb,
     * `translate(16px)` when checked) and the row uses the same 12px vertical
     * rhythm and `.5px` divider the plugin cards' fields use, so it reads as one
     * more field of the card it was injected into. No literal colour: both
     * themes follow the alias tokens for free.
     *
     * The `li[data-dshwst-off]` rules are the "greyed out" state. They target
     * the card's own children with `:not([data-dshwst-row])` so the switch stays
     * legible and operable while everything it governs is dimmed and inert.
     */
    const CSS = [
      '.dshwst-row{display:flex;flex-direction:column;gap:6px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshwst-toggleRow{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.dshwst-toggleLabel{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5}',
      '.dshwst-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
      '.dshwst-error{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}',
      '.dshwst-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .16s}',
      '.dshwst-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.dshwst-switch:disabled{cursor:default;opacity:.5}',
      '.dshwst-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dshwst-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}',
      '.dshwst-switch[aria-checked=true] .dshwst-thumb{transform:translate(16px)}',
      'li[data-dshwst-off] > button[aria-expanded]{opacity:.6;transition:opacity .16s}',
      'li[data-dshwst-off] > div > :not([data-dshwst-row]){opacity:.45;transition:opacity .16s}',
      'li[data-dshwst-off] > div > :not([data-dshwst-row]) input,li[data-dshwst-off] > div > :not([data-dshwst-row]) button{pointer-events:none}',
    ].join('');

    // ── the shipped card's shape ────────────────────────────────────────────
    //
    // PluginCard renders:
    //   <li class=…card>                     <- the card; we mark this
    //     <button aria-expanded=…>           <- header, always present
    //       <span><span>title</span><span>description</span></span>
    //     <div class=…body>                  <- ONLY while expanded
    //       …fields… <div class=…footer>…</div>
    //
    // Class names are content-hashed by the shell's CSS modules and change
    // between releases, so everything below is found structurally: by tag, by
    // `aria-expanded`, and by label text.

    /** The card's own disclosure button (a direct child), or null. */
    function headerButtonOf(li) {
      const children = li.children;
      for (let i = 0; children !== undefined && i < children.length; i += 1) {
        const child = children[i];
        if (child.tagName === 'BUTTON' && child.hasAttribute('aria-expanded')) return child;
      }
      return null;
    }

    /** The expanded body (the card's only direct `<div>` child), or null while collapsed. */
    function bodyOf(li) {
      const children = li.children;
      for (let i = 0; children !== undefined && i < children.length; i += 1) {
        const child = children[i];
        if (child.tagName === 'DIV') return child;
      }
      return null;
    }

    /** The card's title text when it is the one we govern, else null. */
    function titleOf(li) {
      const button = headerButtonOf(li);
      if (button === null) return null;
      const spans = button.querySelectorAll('span');
      for (let i = 0; i < spans.length; i += 1) {
        const span = spans[i];
        if (span.childElementCount !== 0) continue;
        const text = String(span.textContent || '').trim();
        if (CARD_TITLES.indexOf(text) !== -1) return text;
      }
      return null;
    }

    /** The nearest ancestor `<li>` that looks like a plugin card, or null. */
    function enclosingCard(node) {
      let cursor = node === null || node === undefined ? null : node.parentNode;
      while (cursor !== null && cursor !== undefined && cursor.nodeType === 1) {
        if (cursor.tagName === 'LI' && headerButtonOf(cursor) !== null) return cursor;
        cursor = cursor.parentNode;
      }
      return null;
    }

    /** The row this bundle already injected into a body, or null. */
    function ownRowIn(body) {
      const children = body.children;
      for (let i = 0; children !== undefined && i < children.length; i += 1) {
        if (children[i].hasAttribute(ROW_ATTR)) return children[i];
      }
      return null;
    }

    // ── transport ───────────────────────────────────────────────────────────

    /**
     * One call into the host route.
     *
     * The route answers a JSON envelope and is same-origin, so the browser
     * attaches the platform's login cookie automatically. Transport faults and
     * failure envelopes are folded into one `{ok:…}` shape so no caller has to
     * tell them apart.
     *
     * @param method - endpoint name, matching a host-core method.
     * @param args - JSON payload.
     * @returns `{ ok: true, value }` or `{ ok: false, error }`.
     */
    function hostCall(method, args) {
      let pending;
      try {
        pending = fetch(`${CHANNEL}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(args || {}),
        });
      } catch (error) {
        return Promise.resolve({ ok: false, error: String(error && error.message ? error.message : error) });
      }
      return Promise.resolve(pending).then(
        (res) =>
          res.json().then(
            (envelope) => {
              if (envelope && envelope.ok) return { ok: true, value: envelope.value };
              // The host half answers `{ ok: false, error: { code, message } }`;
              // a bare string is tolerated so a different channel's shape cannot
              // turn a real reason into a meaningless one.
              const failure = envelope ? envelope.error : undefined;
              const message = typeof failure === 'string'
                ? failure
                : failure
                  ? failure.message || failure.code || 'host call failed'
                  : `HTTP ${res.status}`;
              return { ok: false, error: String(message) };
            },
            () => ({ ok: false, error: `HTTP ${res.status} with a non-JSON body` }),
          ),
        (error) => ({ ok: false, error: String(error && error.message ? error.message : error) }),
      );
    }

    // ── row and state ───────────────────────────────────────────────────────

    /**
     * Build the injected row.
     *
     * Markup mirrors the shell's own toggle field: a label and a `role="switch"`
     * button on one line, a hint underneath, and an error line that is present
     * but hidden until a save fails. The parts are stashed on the row element so
     * a re-patch after a collapse/expand cycle can adopt the row it finds
     * instead of building a second one.
     *
     * @param ui - the shared plugin state.
     * @returns the row element (not yet attached).
     */
    function buildRow(ui) {
      const row = document.createElement('div');
      row.className = 'dshwst-row';
      row.setAttribute(ROW_ATTR, '');

      const line = document.createElement('div');
      line.className = 'dshwst-toggleRow';

      const label = document.createElement('span');
      label.className = 'dshwst-toggleLabel';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'dshwst-switch';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', 'false');
      toggle.appendChild(document.createElement('span')).className = 'dshwst-thumb';
      toggle.addEventListener('click', () => {
        void toggleSwitch(ui);
      });

      line.appendChild(label);
      line.appendChild(toggle);

      const hint = document.createElement('p');
      hint.className = 'dshwst-hint';

      const error = document.createElement('p');
      error.className = 'dshwst-error';
      error.setAttribute('role', 'status');
      error.hidden = true;

      row.appendChild(line);
      row.appendChild(hint);
      row.appendChild(error);
      row.dshwstParts = { label, toggle, hint, error };
      return row;
    }

    /**
     * Paint the shared state onto the card and the injected row.
     *
     * `known` is what keeps this honest: until the host has answered once the
     * switch is rendered disabled rather than in a position we cannot back up,
     * so the row is never "wrong first, right later".
     *
     * @param ui - the shared plugin state.
     */
    function syncCard(ui) {
      const card = ui.card;
      if (card !== null && card.isConnected) {
        if (ui.known && !ui.enabled) card.setAttribute(OFF_ATTR, '');
        else card.removeAttribute(OFF_ATTR);
      }
      const row = ui.row;
      const parts = row === null || row === undefined ? null : row.dshwstParts;
      if (parts === null || parts === undefined || !row.isConnected) return;

      const label = ui.t('toggle');
      parts.label.textContent = label;
      parts.toggle.setAttribute('aria-label', label);
      parts.toggle.title = label;
      parts.toggle.setAttribute('aria-checked', ui.enabled ? 'true' : 'false');
      parts.toggle.disabled = ui.busy || !ui.known;
      parts.hint.textContent = ui.known ? ui.t(ui.enabled ? 'on' : 'off') : ui.t('unknown');
      if (ui.error.length > 0) {
        parts.error.textContent = ui.error;
        parts.error.hidden = false;
      } else {
        parts.error.textContent = '';
        parts.error.hidden = true;
      }
    }

    /** Whether the card is patched and needs no further work this mutation. */
    function settled(ui) {
      const card = ui.card;
      if (card === null || !card.isConnected || !card.hasAttribute(CARD_ATTR)) return false;
      // Collapsed: there is no body to inject into, so the grey state is all
      // this card owes until it is expanded again.
      if (bodyOf(card) === null) return true;
      const row = ui.row;
      return row !== null && row.isConnected && row.parentNode === bodyOf(card);
    }

    /**
     * Patch one candidate element if it really is the card we govern.
     * @param li - a candidate `<li>`.
     * @param ui - the shared plugin state.
     * @returns the card, or null when this is not it.
     */
    function patchCard(li, ui) {
      if (titleOf(li) === null) return null;
      ui.card = li;
      li.setAttribute(CARD_ATTR, '');
      const body = bodyOf(li);
      let row = null;
      if (body !== null) {
        row = ownRowIn(body);
        if (row === null) {
          row = buildRow(ui);
          body.insertBefore(row, body.firstChild);
        }
      }
      ui.row = row;
      syncCard(ui);
      return li;
    }

    /**
     * Patch whatever card an inserted subtree brought with it.
     *
     * Only the inserted subtree is inspected, and the one ancestor that could
     * have gained a body is checked first — the hot path during a streaming
     * conversation never reaches this function at all, because `settled()`
     * short-circuits the observer first.
     *
     * @param root - an inserted node (or the document, for the initial scan).
     * @param ui - the shared plugin state.
     * @returns the patched card, or null.
     */
    function patchCardIn(root, ui) {
      if (root === null || root === undefined) return null;
      const candidates = [];
      const owner = enclosingCard(root);
      if (owner !== null) candidates.push(owner);
      // Elements and the document itself are both scanned; a document-level scan
      // is only ever the initial one and the 400ms backstop, never the hot path.
      if ((root.nodeType === 1 || root.nodeType === 9) && typeof root.querySelectorAll === 'function') {
        if (root.nodeType === 1 && root.tagName === 'LI') candidates.push(root);
        const nested = root.querySelectorAll('li');
        for (let i = 0; i < nested.length; i += 1) candidates.push(nested[i]);
      }
      for (let i = 0; i < candidates.length; i += 1) {
        if (patchCard(candidates[i], ui) !== null) return candidates[i];
      }
      return null;
    }

    /** In-flight one-shot read, so a burst of patches issues one request. */
    let refreshing = null;

    /**
     * Read the host's stored switch once.
     *
     * Called at plugin load and never on a timer: the position is a durable
     * fact that only this page can change, so polling would buy nothing and
     * cost the first paint.
     *
     * @param ui - the shared plugin state.
     * @returns the transport answer.
     */
    function refresh(ui) {
      if (refreshing !== null) return refreshing;
      refreshing = hostCall('state', {}).then((answer) => {
        refreshing = null;
        const value = answer.ok ? answer.value : null;
        if (value !== null && typeof value === 'object' && typeof value.enabled === 'boolean') {
          ui.enabled = value.enabled;
          ui.known = true;
          ui.error = '';
        } else if (!answer.ok) {
          ui.error = answer.error;
        }
        syncCard(ui);
        return answer;
      });
      return refreshing;
    }

    /**
     * Flip the switch: optimistic, then reconciled against the host's answer.
     *
     * A refused write is rolled back rather than left showing a position the
     * host never accepted, and the reason is rendered in the row instead of
     * only reaching the console.
     *
     * @param ui - the shared plugin state.
     */
    async function toggleSwitch(ui) {
      if (ui.busy || !ui.known) return;
      const previous = ui.enabled;
      ui.enabled = !previous;
      ui.busy = true;
      ui.error = '';
      syncCard(ui);

      const answer = await hostCall('set', { enabled: ui.enabled });
      ui.busy = false;
      const value = answer.ok ? answer.value : null;
      if (value !== null && typeof value === 'object' && typeof value.enabled === 'boolean') {
        ui.enabled = value.enabled;
        ui.known = true;
      } else {
        ui.enabled = previous;
        ui.error = answer.ok ? 'the host did not report the new state' : answer.error;
      }
      syncCard(ui);
    }

    /** Required client services: the locale registry, for the row's copy. */
    const inject = ['locale'];

    /**
     * Client plugin body: inject the stylesheet, resolve copy, and keep the
     * shipped card patched for as long as the settings dialog lives.
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
      }, 'dsh-websearch-toggle: card stylesheet');

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
          // The dictionary registration outlives the card, so tie it to the fiber.
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

      const ui = { card: null, row: null, enabled: true, known: false, busy: false, error: '', t: translate };

      // One read at load, deliberately not on a timer and not when Settings
      // opens: by the time the card can be on screen the stored position is
      // already known, so it is never painted in one state and corrected into
      // another (the one bug this family of plugins has actually shipped).
      refresh(ui);

      if (typeof locale.subscribe === 'function') {
        const off = locale.subscribe(() => {
          syncCard(ui);
        });
        if (typeof off === 'function') ctx.effect(() => off, 'dsh-websearch-toggle: locale subscription');
      }

      // The settings dialog mounts when the user opens it and unmounts on close,
      // and the card body mounts only while the card is expanded, so the row has
      // to be injected whenever the body appears rather than once at load.
      //
      // A MutationObserver callback already runs as a microtask at the end of
      // React's commit — after the nodes are in the DOM, before the frame is
      // painted — so the insertion lands in the same frame the body does, with
      // no timer in between. The cost of being that hot is bounded two ways: the
      // callback returns immediately while the row is intact, and it inspects
      // only the nodes just added.
      ctx.effect(() => {
        patchCardIn(document, ui);
        if (typeof MutationObserver !== 'function' || !document.body) return () => {};

        let sweep = 0;
        const backstop = () => {
          if (sweep !== 0) return;
          sweep = setTimeout(() => {
            sweep = 0;
            if (settled(ui)) return;
            patchCardIn(document, ui);
          }, SWEEP_MS);
        };

        const observer = new MutationObserver((records) => {
          if (settled(ui)) return;
          for (const record of records) {
            for (const node of record.addedNodes) {
              // A label written into an already-mounted card arrives as a text
              // node, so resolve the enclosing card before giving up on it.
              if (node.nodeType === 3) {
                const owner = enclosingCard(node);
                if (owner !== null && patchCard(owner, ui) !== null) return;
                continue;
              }
              if (node.nodeType !== 1) continue;
              if (patchCardIn(node, ui) !== null) return;
            }
          }
          backstop();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
          observer.disconnect();
          if (sweep !== 0) clearTimeout(sweep);
        };
      }, 'dsh-websearch-toggle: web search card');
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__test = {
      CSS,
      EN,
      ZH,
      NS,
      CHANNEL,
      CARD_ATTR,
      OFF_ATTR,
      ROW_ATTR,
      SWEEP_MS,
      CARD_TITLES,
      headerButtonOf,
      bodyOf,
      titleOf,
      enclosingCard,
      ownRowIn,
      hostCall,
      buildRow,
      syncCard,
      settled,
      patchCard,
      patchCardIn,
      refresh,
      toggleSwitch,
      createUi: (t) => ({ card: null, row: null, enabled: true, known: false, busy: false, error: '', t }),
    };
    return module.exports;
  },
});
