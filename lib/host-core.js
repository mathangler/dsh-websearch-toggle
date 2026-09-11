/**
 * dsh-websearch-toggle — host-side core, deliberately transport-free.
 *
 * The switch lives in the browser, but the capability it controls is a HOST
 * fact. `web_search` is not a model feature: the `tool-web` row of an agent
 * preset registers the tool into that preset's scoped layer, and the model sees
 * it through the prompt assembly the agent loop builds before every step. A
 * third-party plugin cannot unregister another preset's row, and
 * `ctx.tools.restrict()` explicitly refuses an unscoped context ("a
 * context-global restriction would mask every agent"), so the supported seam is
 * the assembly waterfall itself: `system-prompt/assemble` returns a value that
 * the registry treats as authoritative.
 *
 * Turning the switch off therefore removes the tool from the model's catalog on
 * every subsequent step, and removes the prompt section that tells the model to
 * use it — the same two facts `tool-web` would have declined to register had its
 * `search` flag been false. `tools.guard()` carries the execution-side half: a
 * call that was already in flight when the switch flipped is refused instead of
 * billing the search provider.
 *
 * Nothing here touches `req`/`res`, `ctx`, or the filesystem: the storage seam
 * is injected as `read`/`write`, which is what makes the whole toggle testable
 * in plain Node.
 *
 * @module dsh-websearch-toggle/host-core
 */

/** Settings namespace this plugin owns. Lowercase-hyphenated, like every DSH namespace. */
export const NAMESPACE = 'web-search-toggle';

/** The model-facing tool this switch governs. */
export const WEB_SEARCH_TOOL = 'web_search';

/** The prompt section `tool-web` registers alongside that tool. */
export const WEB_SEARCH_SECTION = 'tool:web_search';

/**
 * A refusal the browser is meant to read and show.
 *
 * Transport faults (4xx/5xx) are wire faults; everything a user can act on
 * rides a 200 with a failure envelope carrying one of these codes.
 */
export class ToggleError extends Error {
  /**
   * @param code - stable machine-readable code, `websearch-toggle/…`.
   * @param message - human-readable reason, shown in the card.
   */
  constructor(code, message) {
    super(message);
    this.name = 'ToggleError';
    this.code = code;
  }
}

/**
 * Build the toggle's state machine over an injected storage seam.
 *
 * @param options - the seam and the tool identity to govern.
 * @param options.read - read the stored section; `undefined` while storage is absent.
 * @param options.write - persist `enabled`; rejects (with {@link ToggleError}) when it cannot.
 * @param [options.toolName] - model-facing tool to withhold; defaults to `web_search`.
 * @param [options.sectionName] - prompt section to withhold; defaults to `tool:web_search`.
 * @returns the core: state adoption, the snapshot the browser reads, the write path,
 *   and the two pure projections the host effects use.
 */
export function createCore(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('createCore(options) requires an options object');
  const { read, write } = options;
  if (typeof read !== 'function') throw new TypeError('createCore requires read()');
  if (typeof write !== 'function') throw new TypeError('createCore requires write(enabled)');
  const toolName = options.toolName === undefined ? WEB_SEARCH_TOOL : String(options.toolName);
  const sectionName = options.sectionName === undefined ? WEB_SEARCH_SECTION : String(options.sectionName);

  /**
   * Effective state. `known` is false until storage has answered once, which is
   * what lets the browser tell "off" apart from "not asked yet" instead of
   * painting a switch position it cannot back up.
   *
   * The default is ON: a deployment whose settings service never arrives keeps
   * the shipped capability rather than silently removing it.
   */
  let enabled = true;
  let known = false;

  /** Adopt a section a caller read from storage (or pushed through an event). */
  function adopt(section) {
    if (section === null || typeof section !== 'object') return;
    if (typeof section.enabled === 'boolean') {
      enabled = section.enabled;
      known = true;
    }
  }

  /** The state the browser renders. */
  function snapshot() {
    return { enabled, known, tool: toolName };
  }

  /**
   * Persist the requested state through the injected seam, then adopt it.
   *
   * Adoption happens only after the write resolves: the settings document is
   * the authority, and a rejected write must leave the effect exactly as it
   * was rather than half-applied.
   *
   * @param next - the requested state.
   * @returns the new snapshot.
   */
  async function setEnabled(next) {
    if (typeof next !== 'boolean') {
      throw new ToggleError('websearch-toggle/bad-argument', '`enabled` must be a boolean');
    }
    await write(next);
    enabled = next;
    known = true;
    return snapshot();
  }

  /** Re-read storage; failures are reported, never guessed around. */
  function reload() {
    adopt(read());
    return snapshot();
  }

  /**
   * Withhold the governed tool — and the prompt section that advertises it —
   * from one assembled prompt.
   *
   * Returning the SAME object when nothing matched matters: the agent loop
   * compares the assembly's tool list against the logged request header to
   * decide whether a new request series starts, and an unchanged list must not
   * look changed.
   *
   * @param assembly - the assembly returned by the waterfall's `next()`.
   * @returns the assembly the model will actually be prompted with.
   */
  function project(assembly) {
    if (enabled) return assembly;
    if (assembly === null || typeof assembly !== 'object') return assembly;
    const tools = Array.isArray(assembly.tools) ? assembly.tools : null;
    const sections = Array.isArray(assembly.sections) ? assembly.sections : null;
    const keptTools = tools === null ? null : tools.filter((tool) => tool === null || typeof tool !== 'object' || tool.name !== toolName);
    const keptSections = sections === null ? null : sections.filter((section) => section === null || typeof section !== 'object' || section.name !== sectionName);
    const toolsChanged = keptTools !== null && keptTools.length !== tools.length;
    const sectionsChanged = keptSections !== null && keptSections.length !== sections.length;
    if (!toolsChanged && !sectionsChanged) return assembly;
    return {
      ...assembly,
      ...(toolsChanged ? { tools: keptTools } : {}),
      ...(sectionsChanged ? { sections: keptSections } : {}),
    };
  }

  /**
   * The reason to refuse one dispatch, or `undefined` to let it run.
   *
   * This is the second half of the switch, not a duplicate of it: a request
   * that was already on the wire when the user flipped it can still carry the
   * tool, and refusing it here is what keeps that call from reaching the billed
   * provider.
   *
   * @param name - the tool name a pending call addresses.
   * @returns the refusal message, or `undefined`.
   */
  function deny(name) {
    if (enabled) return undefined;
    if (name !== toolName) return undefined;
    return `Web search is turned off in Settings → Plugins → Web search. Tell the user it is disabled there instead of retrying; web_fetch still works.`;
  }

  return { adopt, snapshot, setEnabled, reload, project, deny, toolName, sectionName, namespace: NAMESPACE };
}

/**
 * The method map the HTTP route dispatches onto.
 *
 * One endpoint per user-facing operation, each answering the platform's
 * envelope: `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 *
 * @param core - the core built by {@link createCore}.
 * @returns the endpoint map.
 */
export function createHandlers(core) {
  return {
    /** Current switch state. */
    async state() {
      return core.snapshot();
    },
    /**
     * Write the switch.
     * @param args - `{ enabled: boolean }`.
     * @returns the new state.
     */
    async set(args) {
      const input = args === null || typeof args !== 'object' ? {} : args;
      return core.setEnabled(input.enabled);
    },
  };
}
