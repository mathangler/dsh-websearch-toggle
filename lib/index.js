/**
 * dsh-websearch-toggle — host half.
 *
 * A Cordis plugin row (`name: 'dsh-websearch-toggle'`, entry id
 * `websearch-toggle`) that owns one durable boolean and applies it to the two
 * places `web_search` actually exists:
 *
 *   1. `system-prompt/assemble` — the assembly carries the model's tool catalog
 *      and the prompt sections built for the step. Withholding the tool AND the
 *      `tool:web_search` section is what the preset's own `tool-web.search:
 *      false` would have done; doing it in the waterfall is what makes the
 *      switch live, because a preset's rows are fixed for the life of the
 *      process and an agent's session.
 *   2. `tools.guard()` — a plain-context guard applies globally, so a call that
 *      was already dispatched when the switch flipped is refused instead of
 *      reaching the billed DeepSeek search endpoint.
 *
 * ## How the boolean is stored (DSH 0.1.7)
 *
 * 0.1.7 replaced the old hand-registered settings section with the ordinary
 * plugin `Config` plane, and this plugin moved with it. The model now is:
 *
 *   - a plugin exports a schemastery `Config` object;
 *   - the settings system projects that Config into a form automatically, and
 *     the form's NAMESPACE IS the Loader entry id — `websearch-toggle` here,
 *     exactly as `web-search-deepseek` is that plugin's namespace;
 *   - `apply(ctx, config)` receives the resolved config, and
 *     `config.<field>.get()` is a LIVE accessor, so a settings write from the
 *     browser is visible on the very next read with no subscription to wire.
 *
 * That is why there is no `settings` service use here any more: `installSection`
 * does not exist in 0.1.7, `settings.get` does not exist either, and a plugin
 * that still calls them registers nothing — which is precisely what happened on
 * the 0.1.7 upgrade: the namespace never appeared in `settings.describe()`, so
 * the browser half had nothing to read or write and its switch sat dead.
 *
 * 0.1.7 also stopped serving `<dshHome>/settings.yaml` as the live document; the
 * profile's own configuration document is authoritative now (settings.yaml is
 * imported once, then renamed `settings.yaml.imported`).
 *
 * @module dsh-websearch-toggle
 */
import z from '@deepseek-ai/schemastery';
import { createCore } from './host-core.js';

/** Cordis plugin name reported to the loader. Must match the row's `name`. */
const name = 'websearch-toggle';

/**
 * `systemPrompt` carries the tool-withholding waterfall and `tools` carries the
 * guard. Both are injected optionally below, so a composition without them still
 * boots and keeps whichever half it can serve.
 */
const inject = [];

/**
 * The Loader entry id, which is also this plugin's settings namespace.
 *
 * These are not two facts: `configEditor.entries()` is keyed by `options.id`, and
 * the browser half reaches this plugin's form with
 * `configForms.get('websearch-toggle')`.
 */
const SETTINGS_NAMESPACE = 'websearch-toggle';

/**
 * The switch's Config schema — and, on 0.1.7, its settings page.
 *
 * `enabled` defaults to true, so an entry that omits `config` means the shipped
 * behaviour (search available) rather than a silently removed capability.
 *
 * `.volatile()` is REQUIRED, and this is the single most important line in the
 * file. `SettingsForms.describe()` builds each namespace through
 * `volatileForm(schema)`, which keeps only fields carrying `meta.volatile` and
 * returns `undefined` when none do — and `describe()` then skips the entry
 * entirely:
 *
 *   const form = volatileForm(schema);
 *   if (form === void 0) return [];
 *
 * A schema without it therefore produces NO namespace at all, so the browser half
 * finds no form, reads nothing, and its switch sits disabled. `.volatile()` is
 * what marks a field as user-settable at runtime rather than fixed by the
 * composition — every field of the shipped `dsh-web-search-deepseek` Config
 * carries it for the same reason.
 */
const Config = z.object({ enabled: z.boolean().default(true).volatile() });

/**
 * Read the live position out of the resolved config.
 *
 * `config.<field>` is normally a live accessor with `.get()`, which is what
 * makes the switch take effect on the next step instead of the next restart. A
 * plain boolean is accepted too so the plugin still works if a deployment hands
 * the config over already unwrapped.
 *
 * @param config - the config Cordis resolved for this entry, if any.
 * @returns whether web search is enabled; absent config means the default ON.
 */
function enabledOf(config) {
  const field = config === null || config === undefined ? undefined : config.enabled;
  if (field !== null && field !== undefined && typeof field.get === 'function') return field.get() === true;
  if (typeof field === 'boolean') return field;
  return true;
}

/**
 * Host plugin body: adopt the committed state and wire the two effects.
 *
 * The browser half owns the WRITE (through its settings form); this half only
 * reads. `core.reload()` runs before every projection and every guard so each
 * step sees the committed position rather than one cached at boot.
 *
 * @param ctx - Host Cordis context.
 * @param config - the resolved Config for this entry.
 */
function apply(ctx, config) {
  const core = createCore({
    read: () => ({ enabled: enabledOf(config) }),
    // Unused: the settings form is the single writer. Present so the core keeps
    // its full shape and its refusal message stays accurate if ever called.
    write: async () => {
      throw new Error('web search is switched from the Plugins page, not from the Host');
    },
  });

  // Adopt the committed value synchronously, before any step can be assembled.
  core.reload();

  // The model's tool catalog and prompt sections, withheld per step. The
  // waterfall's return value is authoritative (only a `complete` prompt section
  // is restored afterwards, and `tool:web_search` is not one).
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      core.reload();
      return core.project(await next());
    });
  });

  // Execution-side half: a call dispatched before the switch flipped is refused
  // rather than sent to the billed provider. A plain-context guard applies to
  // every agent, which is exactly the scope of a global capability switch.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.tools.guard((execution) => {
      core.reload();
      return core.deny(execution === null || execution === undefined ? undefined : execution.name);
    });
  });

  if (!core.snapshot().enabled && ctx.logger !== undefined && typeof ctx.logger.info === 'function') {
    ctx.logger.info('web search is OFF (web_search withheld from every agent)');
  }
}

export { apply, inject, name, Config, SETTINGS_NAMESPACE, enabledOf };
