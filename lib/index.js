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
 * State lives in `<dshHome>/websearch-toggle.json`, written atomically. It is
 * deliberately NOT a registered settings namespace: a namespace would have to
 * be declared with a `@deepseek-ai/schemastery` schema, and this package is
 * installed as a link into the profile, so it resolves modules from its own
 * directory rather than the profile's — the same reason every host half in this
 * family imports nothing but `node:` builtins and its own relative modules.
 *
 * The browser half reaches this file's state over one same-origin route. As in
 * the platform's own channels, every request passes
 * `connection.requestRejection(req)` BEFORE a handler or a body read, so an
 * unauthenticated or cross-origin caller never gets in.
 *
 * @module dsh-websearch-toggle
 */
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createCore, createHandlers, ToggleError } from './host-core.js';

/** Cordis plugin name reported to the loader. */
const name = 'websearch-toggle';

/**
 * `webServer` carries the route; `connection` is the trust fence. `tools` is
 * injected optionally below, so a composition without a tool registry still
 * boots and keeps the assembly half of the switch working.
 */
const inject = ['webServer', 'connection'];

/** Absolute route prefix owned by this plugin; must match the client half. */
const CHANNEL = '/websearch-toggle';

/** The switch is one boolean; anything larger than this is hostile. */
const MAX_BODY_BYTES = 8 * 1024;

/** One endpoint segment: the names `host-core` exports, and nothing else. */
const ENDPOINT_RE = /^[A-Za-z0-9_$.-]+$/;

/** File name inside the DSH home directory. */
const STATE_FILE = 'websearch-toggle.json';

/**
 * Resolve the state file.
 *
 * `DSH_HOME` wins when set, exactly as `dsh-home-paths` resolves it; otherwise
 * the home is `~/.dsh`. Resolved per call rather than at module load so a test
 * can point it at a temporary directory.
 *
 * @returns the absolute path of this plugin's state file.
 */
function statePath() {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  return join(home, STATE_FILE);
}

/** Read the persisted section, or `undefined` when absent/unreadable/malformed. */
function readState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    // A missing file is the normal first-run case, and a corrupt one must not
    // take the host down: both leave the capability at its shipped state.
    return undefined;
  }
}

/** Write the section through a temporary file, then rename it into place. */
async function writeState(file, enabled) {
  const body = `${JSON.stringify({ enabled }, null, 2)}\n`;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body, 'utf8');
  await rename(temporary, file);
}

/** Success envelope; the client half unwraps `value`. */
const ok = (value) => ({ ok: true, value });

/** Failure envelope; the client half surfaces `error.message`. */
const fail = (code, message) => ({ ok: false, error: { code, message } });

/** JSON response. `no-store`: the answer is a live fact about this machine. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling. */
async function readBoundedBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/**
 * Run one endpoint and answer it with the platform's envelope convention.
 * @param handlers - the host-core method map.
 * @param endpoint - validated endpoint name.
 * @param req - incoming request.
 * @param res - outgoing response.
 */
async function dispatch(handlers, endpoint, req, res) {
  const fn = Object.prototype.hasOwnProperty.call(handlers, endpoint) ? handlers[endpoint] : undefined;
  if (typeof fn !== 'function') {
    sendJson(res, 404, fail('websearch-toggle/unknown-endpoint', `unknown endpoint ${JSON.stringify(endpoint)}`));
    return;
  }
  const raw = await readBoundedBody(req);
  if (raw === null) {
    sendJson(res, 413, fail('websearch-toggle/too-large', `request body exceeds ${MAX_BODY_BYTES} bytes`));
    return;
  }
  let payload = {};
  if (raw.trim() !== '') {
    try {
      payload = JSON.parse(raw);
    } catch {
      sendJson(res, 400, fail('websearch-toggle/bad-request', 'body is not valid JSON'));
      return;
    }
  }
  try {
    sendJson(res, 200, ok(await fn(payload !== null && typeof payload === 'object' ? payload : {})));
  } catch (error) {
    // Business failures answer HTTP 200 with a failure envelope, the convention
    // the platform's own channels use, so the card can show the reason instead
    // of a generic transport fault.
    const code = error instanceof ToggleError ? error.code : 'websearch-toggle/internal';
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 200, fail(code, message));
  }
}

/**
 * Host plugin body: adopt the persisted state, wire the two effects, publish the
 * route.
 * @param ctx - Host Cordis context.
 */
function apply(ctx) {
  const file = statePath();
  const core = createCore({
    read: () => readState(file),
    write: async (enabled) => {
      try {
        await writeState(file, enabled);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new ToggleError('websearch-toggle/persist-failed', `Could not write ${file}: ${detail}`);
      }
    },
  });

  // Synchronous and tiny: the state is in force before the first assembly, so
  // no session can observe a step composed under the other setting.
  core.reload();
  if (!core.snapshot().enabled && ctx.logger !== undefined && typeof ctx.logger.info === 'function') {
    ctx.logger.info('web search is OFF (web_search withheld from every agent)');
  }

  // The model's tool catalog and prompt sections, withheld per step. The
  // waterfall's return value is authoritative (only a `complete` prompt section
  // is restored afterwards, and `tool:web_search` is not one).
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => core.project(await next()));

  // Execution-side half: a call dispatched before the switch flipped is refused
  // rather than sent to the billed provider. A plain-context guard applies to
  // every agent, which is exactly the scope of a global capability switch.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.tools.guard((execution) => core.deny(execution === null || execution === undefined ? undefined : execution.name));
  });

  const handlers = createHandlers(core);

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: CHANNEL,
        handler: async (req, res) => {
          // The platform's fence, first: an untrusted or unauthenticated caller
          // never reaches a handler or a body read.
          const rejection = ctx.connection.requestRejection(req);
          if (rejection !== undefined) {
            res.statusCode = rejection;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('allow', 'POST');
            res.end();
            return;
          }
          const mediaType = String(req.headers['content-type'] || '')
            .split(';', 1)[0]
            .trim()
            .toLowerCase();
          if (mediaType !== 'application/json') {
            sendJson(res, 415, fail('websearch-toggle/bad-request', 'content type must be application/json'));
            return;
          }
          const pathname = new URL(String(req.url), 'http://localhost').pathname;
          const endpoint = pathname.slice(CHANNEL.length).replace(/^\//, '');
          if (!ENDPOINT_RE.test(endpoint)) {
            sendJson(res, 404, fail('websearch-toggle/unknown-endpoint', 'malformed endpoint'));
            return;
          }
          await dispatch(handlers, endpoint, req, res);
        },
      }),
    `dsh-websearch-toggle: ${CHANNEL} route`,
  );
}

export { apply, inject, name, CHANNEL, STATE_FILE, statePath, readState, writeState };
