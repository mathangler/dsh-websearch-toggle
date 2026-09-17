# dsh-websearch-toggle

A live on/off switch **on** the Web search plugin page in DeepSeek Harness.

Open the sidebar **Plugins** page → the **Web search** entry → the switch is the
first control of that entry's page, above the API key, endpoint and max-uses
fields it governs. Nothing appears on the card until you open it, and the
collapsed card carries no control of its own.

English | [中文](README.zh.md)

## What the switch does

Open the sidebar **Plugins** page. A switch appears at the trailing end of the
official **Web search** card's title row — the same position and style as the
switch every card in the **Installed** group already carries. The official card,
its page and its fields are not modified in any way: this plugin appends one
switch to that card after render, and removes it when the plugin unloads.

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

**Check the bundle list after any `remove` + `add`.** `dsh plugin remove` drops
the package from `dsh.profile.bundles` in the profile's `package.json`, and the
following `add` does not always put it back — the dependency is installed, but
the row never composes, so the plugin silently does nothing while its browser
half is still served. If the switch does not appear, confirm the package is
listed in `dsh.profile.bundles` and re-add it there if not.

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

The browser half registers **no slot at all**. Instead it appends one switch to
the official card after render. The reason is that the Plugins page offers only
three seats (`plugins.item`, `plugins.bundle.config`, `plugins.row.config`), and
all three ADD a card or a page — none can put a control INSIDE an existing entry.
Worse, `plugins.item`'s own catalog says: *"a fresh id is added beside the shipped
entries, while reusing a shipped id puts you in THAT cell and replaces it."*
Reusing `web-search` therefore does not decorate the official card, it evicts it —
an earlier build of this package did exactly that and deleted the official Web
search form. So the official card is left alone and the switch is appended to it,
then removed on unload.

The card is found by `li[data-plugin-item="web-search"]`, a stable `data-`
attribute the page sets itself — never a hashed CSS-module class name.

### The schema must be a real one

The settings schema **must** be a genuine schemastery object, and this is not a
style preference. `settings.describe()` calls `schema.toJSON()` on every
registered schema and hands the result to the browser, and that ONE call decides
whether each official plugin page exists at all (each registers only for a
namespace it sees in that list). A hand-rolled validator without `toJSON()`
therefore does far worse than misdescribe this plugin: it throws inside
`describe()` and **removes the Shell, Agent loop, Subagent and Web search pages
from the Plugins page entirely**. An earlier 0.2.x build of this package did
exactly that. The schema is now imported from the platform's own published
package, so the wire format is the real one rather than a copy of it.

The settings schema is declared inline rather than with
`@deepseek-ai/schemastery`: this package installs into
`<profile>/node_modules`, so it resolves modules from its own directory, and
`settings.installSection` accepts any schemastery-compatible validator. A
four-line validator over the single field this plugin owns keeps the package
dependency-free and installable wherever DSH puts it.

The settings schema aside, the host half needs no dependency of its own; the only
one it declares is `@deepseek-ai/schemastery`, because a real schema is not
optional (see above).

## Tests

```bash
node test/host-core.test.mjs   # 14 — the toggle's state machine and projections
node test/wiring.test.mjs      # 10 — namespace install, assembly waterfall, guard
node test/load.test.mjs        # 15 — the browser half against a fake DOM
```

Each file runs directly rather than through `node --test`, which spawns per-file
children (unavailable under a confined sandbox).

The browser-half suite uses a React stub with **real state and effects** and a
render loop that settles them. A no-op `useState` would let every assertion pass
vacuously — the component would sit on its "reading…" placeholder forever and
"no switch until the namespace answers" would be true for entirely the wrong
reason.

## Caveats

- **DOM append, not a slot.** The switch is found by the official card's own
  `data-plugin-item` attribute and appended to the card head. A future release
  that renames that attribute needs the matcher updated.
- **Client-only presence.** If the browser half fails to load, the switch
  disappears from the page but the Host effect stays exactly as stored.
- The switch governs this deployment's process. A second server started from the
  same home reads the same `settings.yaml` but composed at its own boot.
- One DSH quirk, unrelated to this plugin: an already-running session may still
  *list* `web_search` while the switch is off, but a call to it is refused by the
  guard rather than sent to the provider.
