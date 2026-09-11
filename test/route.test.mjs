/**
 * Route-layer tests for the host half.
 *
 * The host half is a Cordis row, so `apply` is driven with a stub context: what
 * is asserted is the contract the browser depends on — the trust fence runs
 * before a body is read, wire faults are 4xx, business failures are 200 with an
 * envelope, and the write lands in the state file the next boot reads.
 *
 * @module dsh-websearch-toggle/test/route
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name, CHANNEL, STATE_FILE } from '../lib/index.js';
import { WEB_SEARCH_SECTION } from '../lib/host-core.js';

/**
 * Boot the host half against a throwaway DSH home.
 * @param options - `preload` seeds the state file, `rejection` makes the fence refuse.
 * @returns the stub context's captured registrations plus a cleanup.
 */
function boot(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dshwst-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  if (options.preload !== undefined) {
    writeFileSync(join(home, STATE_FILE), `${JSON.stringify(options.preload)}\n`, 'utf8');
  }

  const routes = [];
  const listeners = [];
  const guards = [];
  const injected = [];
  let rejection = options.rejection;

  const ctx = {
    effect(fn) {
      return fn();
    },
    on(event, listener) {
      listeners.push({ event, listener });
      return () => {};
    },
    inject(deps, callback) {
      injected.push(...deps);
      if (deps.includes('tools')) {
        callback({
          tools: {
            guard(guard) {
              guards.push(guard);
              return () => {};
            },
          },
        });
      }
      return () => {};
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    connection: { requestRejection: () => rejection },
    logger: undefined,
  };

  apply(ctx);
  if (previous === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previous;

  return {
    home,
    routes,
    listeners,
    guards,
    injected,
    setRejection: (value) => {
      rejection = value;
    },
    stateFile: join(home, STATE_FILE),
    listenerFor: (event) => listeners.find((entry) => entry.event === event),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** A request double: the handler only needs the method, headers, url and a body stream. */
function request(options = {}) {
  const body = options.body === undefined ? '' : options.body;
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  const contentType = options.contentType === null
    ? {}
    : { 'content-type': options.contentType === undefined ? 'application/json' : options.contentType };
  return {
    method: options.method === undefined ? 'POST' : options.method,
    url: options.url === undefined ? `${CHANNEL}/state` : options.url,
    headers: contentType,
    async *[Symbol.asyncIterator]() {
      if (bytes.length > 0) yield bytes;
    },
    resume() {},
  };
}

/** A response double. */
function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(header, value) {
      this.headers[header] = value;
    },
    end(text) {
      this.body = text === undefined || text === null ? '' : String(text);
    },
  };
}

/** Drive the registered route once. */
async function call(booted, options) {
  const res = response();
  await booted.routes[0].handler(request(options), res);
  return res;
}

/** Parse an answered envelope. */
const envelopeOf = (res) => (res.body === '' ? undefined : JSON.parse(res.body));

/** One assembled prompt shaped like the platform's `PromptAssembly`. */
const assembly = () => ({
  sections: [
    { name: 'persona', text: 'You are a coding agent.' },
    { name: WEB_SEARCH_SECTION, text: 'Use the web_search tool.' },
  ],
  contexts: [],
  tools: [{ name: 'read' }, { name: 'web_search' }, { name: 'web_fetch' }],
  variables: {},
});

test('the row declares the plugin identity, its two hard services and no more', () => {
  assert.equal(name, 'websearch-toggle');
  assert.deepEqual(inject, ['webServer', 'connection']);
  assert.equal(CHANNEL, '/websearch-toggle');
});

test('the route is registered as a prefix on the plugin channel', () => {
  const booted = boot();
  try {
    assert.equal(booted.routes.length, 1);
    assert.equal(booted.routes[0].kind, 'prefix');
    assert.equal(booted.routes[0].path, CHANNEL);
    assert.equal(typeof booted.routes[0].handler, 'function');
  } finally {
    booted.cleanup();
  }
});

test('the fence answers before the handler is reached', async () => {
  const booted = boot({ rejection: 401 });
  try {
    const res = await call(booted, { body: { enabled: false } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body, '', 'a rejected request must not reach a handler');
  } finally {
    booted.cleanup();
  }
});

test('wire faults are 4xx and never an envelope', async () => {
  const booted = boot();
  try {
    const wrongMethod = await call(booted, { method: 'GET', body: '' });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.headers.allow, 'POST');

    const wrongType = await call(booted, { contentType: 'text/plain', body: '{}' });
    assert.equal(wrongType.statusCode, 415);

    const missingType = await call(booted, { contentType: null, body: '{}' });
    assert.equal(missingType.statusCode, 415);

    const notJson = await call(booted, { body: 'not json' });
    assert.equal(notJson.statusCode, 400);

    const unknown = await call(booted, { url: `${CHANNEL}/nope` });
    assert.equal(unknown.statusCode, 404);

    const malformed = await call(booted, { url: `${CHANNEL}/../escape` });
    assert.equal(malformed.statusCode, 404);

    const oversized = await call(booted, { body: JSON.stringify({ pad: 'x'.repeat(9000) }) });
    assert.equal(oversized.statusCode, 413);
  } finally {
    booted.cleanup();
  }
});

test('state answers the platform envelope', async () => {
  const booted = boot();
  try {
    const res = await call(booted, {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(envelopeOf(res), {
      ok: true,
      value: { enabled: true, known: false, tool: 'web_search' },
    });
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    booted.cleanup();
  }
});

test('a write answers, lands in the state file, and reads back', async () => {
  const booted = boot();
  try {
    const written = await call(booted, { url: `${CHANNEL}/set`, body: { enabled: false } });
    assert.deepEqual(envelopeOf(written), {
      ok: true,
      value: { enabled: false, known: true, tool: 'web_search' },
    });
    assert.deepEqual(JSON.parse(readFileSync(booted.stateFile, 'utf8')), { enabled: false });

    const read = await call(booted, {});
    assert.deepEqual(envelopeOf(read).value, { enabled: false, known: true, tool: 'web_search' });
  } finally {
    booted.cleanup();
  }
});

test('a bad payload is a 200 business failure, so the card can show the reason', async () => {
  const booted = boot();
  try {
    const res = await call(booted, { url: `${CHANNEL}/set`, body: { enabled: 'off' } });
    assert.equal(res.statusCode, 200);
    const envelope = envelopeOf(res);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'websearch-toggle/bad-argument');
  } finally {
    booted.cleanup();
  }
});

test('a persisted OFF state is in force before the first assembly', async () => {
  const booted = boot({ preload: { enabled: false } });
  try {
    const entry = booted.listenerFor('system-prompt/assemble');
    assert.ok(entry !== undefined, 'the assembly waterfall must be wired');
    const projected = await entry.listener(assembly(), {}, async () => assembly());
    assert.deepEqual(projected.tools.map((tool) => tool.name), ['read', 'web_fetch']);
    assert.deepEqual(projected.sections.map((section) => section.name), ['persona']);
  } finally {
    booted.cleanup();
  }
});

test('an ON state leaves the assembly untouched', async () => {
  const booted = boot();
  try {
    const entry = booted.listenerFor('system-prompt/assemble');
    const input = assembly();
    const projected = await entry.listener(input, {}, async () => input);
    assert.equal(projected, input);
  } finally {
    booted.cleanup();
  }
});

test('the tool guard is registered globally and follows the switch', async () => {
  const booted = boot();
  try {
    assert.equal(booted.injected.includes('tools'), true);
    assert.equal(booted.guards.length, 1);
    assert.equal(booted.guards[0]({ name: 'web_search' }), undefined, 'ON must let the call through');

    await call(booted, { url: `${CHANNEL}/set`, body: { enabled: false } });
    assert.equal(typeof booted.guards[0]({ name: 'web_search' }), 'string');
    assert.equal(booted.guards[0]({ name: 'web_fetch' }), undefined);
  } finally {
    booted.cleanup();
  }
});
