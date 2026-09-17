# dsh-websearch-toggle

A live on/off switch **on** the Web search plugin page in DeepSeek Harness.

Open the sidebar **Plugins** page → the **Web search** entry → the switch is the
first control of that entry's page, above the API key, endpoint and max-uses
fields it governs. Nothing appears on the card until you open it, and the
collapsed card carries no control of its own.

English | [中文](README.zh.md)

## What the switch does

**Off**

- Every agent stops receiving the `web_search` tool. The tool — and the prompt
  section that tells the model to use it — is withheld from the prompt assembly
  of the next model step, in every session, including ones that already exist.
  The model never sees the tool, so it never calls it and nothing is sent to the
  billed DeepSeek search endpoint.
- A call that was already dispatched when the switch flipped is refused by a
  global tool guard instead of reaching the provider.

**On** — both effects are undone on the next step. No restart, no new session.

## What it does not touch

- `web_fetch` and the local fetch provider keep working. This is a search
  switch, not an internet switch.
- **No profile file is edited.** The `web-search-deepseek` row stays exactly
  where the bundle put it, so the switch is reversible at any moment — unlike
  editing `cordis.patch.yml` or an agent preset.
- The endpoint, key and max-uses values you stored are kept, not cleared. They
  are simply ignored while the switch is off.

## Install

```bash
dsh plugin --profile web add github:mathangler/dsh-websearch-toggle
```

Then **restart `dsh web`**: a bundle row is composed at boot, so a running
server does not serve the new plugin until it restarts.

Built against DSH `0.1.6-alpha.2`. Version 0.1.x targeted 0.1.5, where plugin
configuration lived in Settings; 0.2.x targets the sidebar Plugins page that
0.1.6 introduced.

### Working on this plugin

`github:` and `link:` are mutually exclusive specs:

```bash
dsh plugin --profile web remove dsh-websearch-toggle
dsh plugin --profile web add link:<absolute path to this directory>
```

`link:` symlinks the directory, so edits take effect on the next server start.
Updating an installed `github:` plugin also needs `remove` + `add`, because pnpm
skips resolution while the spec is unchanged.

## State

One boolean in `<dshHome>/settings.yaml`:

```yaml
web-search-toggle:
  enabled: false
```

`dshHome` is `$DSH_HOME` when set, otherwise `~/.dsh`. Absent means **on** — the
shipped behaviour — so a deployment that never writes the key keeps its
capability.

There is no custom route and no separate state file. The browser writes this
namespace through the platform's own settings Remote, with the same revision
fence every other settings form uses, so the browser's write *is* the commit and
the Host learns about it from the namespace it installed.

## Why it is built this way

`web_search` is not a model feature and not a switch the platform exposes. The
`tool-web` row of an agent preset registers the tool into that preset's scoped
layer, and a preset is fixed for the life of the session, so this plugin cannot
unregister it; `ctx.tools.restrict()` is explicitly refused in an unscoped
context ("a context-global restriction would mask every agent"). The supported
seam is therefore the assembly waterfall: `system-prompt/assemble` returns a
value the registry treats as authoritative, so removing the tool and
`tool:web_search` from it is exactly what `tool-web` would have declined to
register had its `search` flag been false — but live, and reversible per step.

The browser half is an ordinary slot registration into `plugins.item` **under
the shipped id `web-search`**, which puts it in that entry's existing cell: the
"Web search" entry keeps its title and its form and gains a switch above them,
the same shape the Subagent entry already has. (The 0.1.x build had to inject
DOM into the card because 0.1.5 had no seat for it; the page now does.)

The settings schema is declared inline rather than with
`@deepseek-ai/schemastery`: this package installs into
`<profile>/node_modules`, so it resolves modules from its own directory, and
`settings.installSection` accepts any schemastery-compatible validator. A
four-line validator over the single field this plugin owns keeps the package
dependency-free and installable wherever DSH puts it.

## Tests

```bash
node test/host-core.test.mjs   # 14 — the toggle's state machine and projections
node test/wiring.test.mjs      #  9 — namespace install, assembly waterfall, guard
node test/load.test.mjs        # 12 — the browser half against a fake DOM and React
```

Each file runs directly rather than through `node --test`, which spawns per-file
children (unavailable under a confined sandbox).

The browser-half suite uses a React stub with **real state and effects** and a
render loop that settles them. A no-op `useState` would let every assertion pass
vacuously — the component would sit on its "reading…" placeholder forever and
"no switch until the namespace answers" would be true for entirely the wrong
reason.

## Caveats

- **The switch is keyed to the shipped entry id `web-search`.** If a future
  release renames that entry, the registration needs the new id.
- **Client-only presence.** If the browser half fails to load, the switch
  disappears from the page but the Host effect stays exactly as stored.
- The switch governs this deployment's process. A second server started from the
  same home reads the same `settings.yaml` but composed at its own boot.
- One DSH quirk, unrelated to this plugin: an already-running session may still
  *list* `web_search` while the switch is off, but a call to it is refused by the
  guard rather than sent to the provider.
