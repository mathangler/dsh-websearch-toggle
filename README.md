# dsh-websearch-toggle

A live on/off switch for the **Web search** plugin card in DeepSeek Harness.

The switch lives where the configuration lives: expand **Settings → Plugins →
Plugin configuration → Web search** and it is the first row of the card. The
collapsed card gets no control at all — only the greyed-out look when the
switch is off.

English | [中文](README.zh.md)

## What the switch does

**Off**

- Every agent stops receiving the `web_search` tool. The tool — and the prompt
  section that tells the model to use it — is withheld from the prompt assembly
  of the next model step, in every session, including ones that already exist.
  The model never sees the tool, so it never calls it and nothing is ever sent
  to the billed DeepSeek search endpoint.
- A pending call that was already dispatched when the switch flipped is refused
  by a global tool guard instead of reaching the provider.
- The card greys out: the API key, endpoint and max-uses controls dim and stop
  accepting input, so it is obvious the configuration is inert.

**On** — everything above is undone on the next step. No restart, no new
session.

## What the switch does *not* touch

- `web_fetch` and the local fetch provider keep working. This is a search
  switch, not an internet switch.
- **No file in the profile is edited.** The `web-search-deepseek` row stays
  exactly where the bundle put it; the switch is an in-process effect, so it can
  be flipped back at any moment. That is the difference between this and
  hand-editing `cordis.patch.yml` or an agent preset.
- The endpoint, key and max-uses values you stored are kept, not cleared. They
  are simply ignored while the switch is off.

## Install

```bash
dsh plugin --profile web add github:mathangler/dsh-websearch-toggle
```

Then **restart `dsh web`** — a bundle row is composed at boot, so a running
server will not serve the switch until it is restarted.

Built against DSH `0.1.5-rc.1`. On restricted networks `github.com` can be
unreachable for `git`; installs go through `codeload.github.com`, which usually
is not.

### Working on this plugin

`github:` and `link:` are mutually exclusive specs. To develop against a local
checkout, swap the install:

```bash
dsh plugin --profile web remove dsh-websearch-toggle
dsh plugin --profile web add link:<absolute path to this directory>
```

`link:` symlinks the directory, so edits take effect on the next server start;
`file:` copies it instead. Updating an already-installed `github:` plugin also
needs `remove` + `add`, because pnpm skips resolution while the spec is
unchanged.

## State

One durable boolean in `<dshHome>/websearch-toggle.json`:

```json
{
  "enabled": true
}
```

`dshHome` is `$DSH_HOME` when set, otherwise `~/.dsh`. The file is written
atomically, read once at boot, and read again when the browser asks. It is
deliberately **not** a registered settings namespace: a namespace needs a
`@deepseek-ai/schemastery` schema, and this package is installed as a link into
the profile, so it resolves modules from its own directory rather than the
profile's — the same reason its host half imports nothing but `node:` builtins.

An absent or unreadable file means **on**, i.e. the shipped behaviour: a broken
state file must never silently remove a capability.

## Why it is built this way

`web_search` is not a model feature and not a switch the platform exposes. The
`tool-web` row of an agent preset registers the tool into that preset's scoped
layer, and a preset is fixed for the life of the session, so a third-party
plugin cannot unregister it. `ctx.tools.restrict()` is explicitly refused in an
unscoped context ("a context-global restriction would mask every agent"). The
supported seam is therefore the assembly waterfall: `system-prompt/assemble`
returns a value the registry treats as authoritative, so removing the tool and
`tool:web_search` from it is exactly what `tool-web` would have declined to
register had its `search` flag been false — but live, and reversible per step.

The browser half injects its row into the card's expanded body with a
`MutationObserver`. Registering a second `settings.plugin.item` card under the
shipped `web-search-deepseek` key would render a *second card* beside the real
one, not a control inside it, and another bundle cannot reach the shipped card's
React tree. The insertion happens synchronously inside the mutation callback, so
the row appears in the same frame the card body does.

## Tests

```bash
node test/host-core.test.mjs   # 14 — the toggle's state machine and projections
node test/route.test.mjs       # 10 — the HTTP route, envelope and trust fence
node test/load.test.mjs        # 18 — the browser half against a fake DOM
pwsh -File test/e2e-serve.ps1  # boots a throwaway `dsh web` on :3099
```

`test/e2e-serve.ps1` proves what unit tests cannot: the host half boots with an
empty stderr, `/plugins/??dsh-websearch-toggle/client.js` serves this build's
symbols, the route answers an authenticated caller (200 + envelope), the write
lands on disk, and the same route refuses an unauthenticated caller (401) and a
non-POST method (405).

Each test file is run directly rather than through `node --test`, which spawns
per-file children; run them from a shell that permits that if you prefer the
aggregate report.

## Caveats

- **The switch depends on the shipped card's shape.** It is found by title text
  (`网页搜索` / `Web search`) and by structure (`li` → `button[aria-expanded]` →
  `div`), never by the shell's hashed class names. A future release that renames
  the card or restructures `PluginCard` needs the matchers revisited.
- **Client-only presentation.** If the browser half fails to load, the switch
  disappears but the host effect stays exactly as persisted.
- The switch controls this deployment's process. A second server started from
  the same home reads the same state file but was composed at its own boot.
