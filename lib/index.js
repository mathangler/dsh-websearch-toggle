/**
 * dsh-websearch-toggle — host half.
 *
 * A Cordis plugin row (`name: 'dsh-websearch-toggle'`) that owns one durable
 * boolean and applies it to the two places `web_search` actually exists:
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
 * The boolean itself is a registered settings namespace, `<dshHome>/settings.yaml`
 * under `web-search-toggle:`. That is deliberate: the browser half writes it
 * through the platform's own `ctx.remote.settings` with the revision fence every
 * other settings form uses, so this plugin needs no upload route, no trust
 * fence, no JSON file and no second source of truth — the browser's write IS the
 * commit, and `settings/updated` is how the effect learns about it.
 *
 * Why the namespace is declared here, and why the schema is a real schemastery
 * object: `settings.describe()` serializes every registered schema with
 * `schema.toJSON()` and hands the result to the browser, and that ONE call is
 * what gates every official plugin page (each registers only for a namespace it
 * sees in that list). A hand-rolled validator without `toJSON` therefore does not
 * merely misrepresent this plugin — it throws inside `describe()` and removes
 * the Shell, Agent loop, Subagent and Web search pages from the Plugins page
 * entirely. An earlier build of this package did exactly that. The schema is
 * imported from the platform's own published package so the wire shape is the
 * real one instead of a copy of it.
 *
 * @module dsh-websearch-toggle
 */
import z from '@deepseek-ai/schemastery';
import { createCore } from './host-core.js';

/** Cordis plugin name reported to the loader. */
const name = 'websearch-toggle';

/**
 * `systemPrompt` carries the tool-withholding waterfall and `tools` carries the
 * guard. Both are injected optionally below, so a composition without them still
 * boots and keeps whichever half it can serve.
 */
const inject = [];

/** Settings namespace carrying this switch. */
const SETTINGS_NAMESPACE = 'web-search-toggle';

/**
 * The switch's schema.
 *
 * `enabled` defaults to true, so an absent section means the shipped behaviour
 * (search available) rather than a silently removed capability.
 */
const SettingsSchema = z.object({ enabled: z.boolean().default(true) });

/**
 * Host plugin body: adopt the committed state, wire the two effects.
 * @param ctx - Host Cordis context.
 */
function apply(ctx) {
  const core = createCore({
    read: () => (ctx.get('settings') === undefined ? undefined : ctx.settings.get(SETTINGS_NAMESPACE)),
    write: async (enabled) => {
      const settings = ctx.get('settings');
      if (settings === undefined) throw new Error('this deployment stores no settings, so the switch cannot be saved');
      await settings.update(SETTINGS_NAMESPACE, { enabled });
    },
  });

  /**
   * Register the namespace as the composition entry's base, and keep the core's
   * copy of the resolved value current.
   *
   * `installSection` is the seam a host-plane consumer uses to take part in a
   * namespace it does not itself own: it contributes the composition entry,
   * keeps working while the provider is present, and falls back to that same
   * entry if the provider detaches. `setSource` hands back the live resolver, so
   * `current()` is always the committed value.
   */
  ctx.inject(['settings'], (settingsCtx) => {
    let current = () => ({ enabled: true });
    settingsCtx.settings.installSection(settingsCtx, SETTINGS_NAMESPACE, SettingsSchema, { enabled: true }, {
      setSource: (source) => {
        current = source;
        // Adopt the committed value synchronously: no step composed after this
        // point may observe the other position.
        core.adopt(source());
      },
      onChange: () => {
        core.adopt(current());
      },
    });
    // The registration above may resolve synchronously or on the next tick,
    // so read once more through whatever resolver is in force by the time the
    // first step is assembled. `setSource` has normally already done this.
    core.adopt(current());
    ctx.effect(() => settingsCtx.settings.subscribe?.(() => {
      core.adopt(current());
    }) ?? (() => {}), 'dsh-websearch-toggle: settings subscription');
  });

  // The model's tool catalog and prompt sections, withheld per step. The
  // waterfall's return value is authoritative (only a `complete` prompt section
  // is restored afterwards, and `tool:web_search` is not one).
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.on('system-prompt/assemble', async (_assembly, _context, next) => core.project(await next()));
  });

  // Execution-side half: a call dispatched before the switch flipped is refused
  // rather than sent to the billed provider. A plain-context guard applies to
  // every agent, which is exactly the scope of a global capability switch.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.tools.guard((execution) => core.deny(execution === null || execution === undefined ? undefined : execution.name));
  });

  if (!core.snapshot().enabled && ctx.logger !== undefined && typeof ctx.logger.info === 'function') {
    ctx.logger.info('web search is OFF (web_search withheld from every agent)');
  }
}

export { apply, inject, name, SETTINGS_NAMESPACE, SettingsSchema };
