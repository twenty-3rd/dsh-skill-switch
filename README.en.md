# dsh-skill-switch

English | [简体中文](README.md)

[![GitHub stars](https://img.shields.io/github/stars/twenty-3rd/dsh-skill-switch?style=social&label=Star)](https://github.com/twenty-3rd/dsh-skill-switch)
[![⭐ 点这里 Star 收藏](https://img.shields.io/badge/%E2%AD%90_%E7%82%B9%E8%BF%99%E9%87%8C_Star-%E6%94%B6%E8%97%8F%E6%8F%92%E4%BB%B6-FFD33D?style=for-the-badge&labelColor=black)](https://github.com/twenty-3rd/dsh-skill-switch)

> ⭐ **Spend 5 seconds to click Star → <https://github.com/twenty-3rd/dsh-skill-switch>**
> (once it opens, click `☆ Star` in the top right of the page → `★ Starred`)
>
> What this plugin does is tiny: it lets you **turn off a skill you don't need in 5 seconds** inside a
> session, **delete every copy** scattered across four or five roots **in one go**, and tell you whether
> a given skill is "valid" or "why it isn't taking effect".
> The time it saves you is worth giving it one click.

A **project-level skill switch + global deletion** plugin for DSH (DeepSeek Harness). It adds a
"Skill Switch" tab inside the session, lays out the current project's skills clearly in one table, and then:

- **One-click switch**: whether a skill is visible in this project takes effect with a single click
  (it writes/deletes the switch file under `<project root>/.dsh/skill-switches/`).
- **Delete all copies**: delete a skill's copies in every known root in one go; afterwards it no
  longer appears in the panel or in the runtime catalog.
- **Valid / error verdict**: every skill is marked with whether it is "valid" for this session —
  **valid = A it is in the skill registry ∧ B the model can invoke it on its own ∧ C the user can
  invoke it explicitly**; if any one of them fails it is an "error", and the row states **which one**
  it is (and which frontmatter field is missing). Skills that the official provider would drop
  entirely (missing `name`/`description`, broken YAML) therefore stay visible and understandable —
  a visibility improvement over dsh-skills-manager.
- **Detail view**: click a row to see how many copies of that name actually exist on disk (root,
  file, rank, whether it will be loaded, whether it can be deleted, and each copy's own frontmatter
  issues).

| | |
|---|---|
| **Version** | **0.4.0** (history in [CHANGELOG](CHANGELOG.md) and the [version history](#version-history)) |
| License | MIT ([LICENSE](LICENSE)) |
| Plugin form | standard DSH two-half: host `exports["."]` → `lib/index.js` (ESM) + client `exports["./client"]` → `lib/client.js` (browser CJS closure factory), `dsh.bundle.patch` → `cordis.patch.yml` |
| Tested environment | DSH Desktop `0.2.0-rc.2` · macOS arm64 · Node ≥ 20 |
| Tests | `pnpm test` **172 tests**; after installing into a profile `pnpm verify:installed` **25 checks** |

> This is **v0.4** of v1 (`dsh-skill-switch` 0.1.x, pure file protocol, no UI). v1's
> **switch file protocol and blocking semantics are unchanged, down to the letter**; upgrading needs
> no migration of any existing switch directory.

## Why you need it

DSH skills are globally discovered and injected per session: an installed skill is visible to every
session. There is no scoping metadata such as `category`/`paths` in SKILL.md, so "this project doesn't
need the A-share analyzer" can only be expressed with an external switch. This plugin provides that
layer, and makes it something you can operate from the page.

## Installation (standard DSH Desktop install support)

This package is a **standard-form DSH plugin**: install it with the official `dsh plugin`, with no
manual profile edits and no global paths to register.

### Which parts of a standard install this package provides

| What a standard install expects | What this package provides |
|---|---|
| `package.json` → `dsh.bundle.patch` points at a composition patch | ✅ `./cordis.patch.yml` (`insert` one `skill-switch` line) |
| host half ESM entry | ✅ `exports["."]` → `lib/index.js` |
| client half declaration | ✅ `dsh.client{ inject, platform: "web" }` + `exports["./client"]` → `lib/client.js` |
| **no build needed at install time** (pnpm ≥ 10 does not run build scripts for git dependencies by default) | ✅ `lib/` is committed with the repository (`lib/index.js`, `lib/client.js`, `lib/types/**`) |
| the client only depends on platform modules | ✅ enforced at build time by the purity gate (cross-plugin collaboration goes through cordis services) |
| the profile stays clean after uninstall | ✅ only adds one entry to `dsh.profile.bundles`; removes the `ctx.skills` wrapper on dispose |

The three things `dsh plugin --profile desktop add …` does: initialize the profile → run
`pnpm <your arguments>` in the profile directory → on success, append the dependencies whose manifest
has `dsh.bundle.patch` into `dsh.profile.bundles`.

### Prerequisites

| Item | Requirement | Notes |
|---|---|---|
| DSH Desktop | `0.2.0-rc.2` tested | the panel uses `ctx.agents` / `snapshot({ scope })` / the `conversation.view` seat / `WebServer`, verified end to end on this version |
| Node | ≥ 20 | `engines.node` |
| pnpm | **the same major version as the profile** (the local App declares `11.7.0`) | `dsh plugin` forwards its arguments to the **pnpm on PATH**; a major version mismatch hits `ERR_PNPM_UNEXPECTED_STORE` |
| Platform | macOS arm64 tested; no platform-specific code | paths use only `node:path`; directory watching is the official provider's job |

### Install commands

```sh
# 1) from GitHub (public repository; lib/ is committed, so no build after installing)
dsh plugin --profile desktop add -w github:twenty-3rd/dsh-skill-switch

# 2) from a local checkout (development / personal use)
dsh plugin --profile desktop add -w /absolute/path/to/dsh-skill-switch
```

**This package supports only these two sources** (GitHub repository / local path) and offers no npm
install. Afterwards you **must restart DSH** (a new bundle changes the host-side composition;
refreshing the page is not enough). After the restart, "Skill Switch" appears in the view tab bar.

### How to confirm it installed correctly

```sh
# structural side: the profile should have exactly two changes
cat ~/.dsh/profiles/desktop/package.json
#   one more entry "dsh-skill-switch" in dependencies
#   one more entry "dsh-skill-switch" in dsh.profile.bundles
# cordis.patch.yml / pnpm-workspace.yaml / cordis.yml should not change at all
```

```sh
# runtime side (only in a source checkout; scripts/ is not shipped in the release package)
cd /path/to/dsh-skill-switch
pnpm install && pnpm verify:installed      # 25 checks: the artifacts mount, block/delete/repair go over real HTTP,
                                           # the client artifact matches the __ModuleLoader__ contract, dispose really removes the wrapper
```

Once both pass, restart the App and "Skill Switch" appears in the tab bar (without a restart, the
structural side can be confirmed but the panel does not appear).

### Uninstall

```sh
dsh plugin --profile desktop remove -w dsh-skill-switch
# restart DSH
```

The panel and the `/skill-switch/api/*` routes disappear together with the fiber dispose, and the
`ctx.skills` wrapper is removed back to the original function (a regression test pins down "after
dispose `off/<name>` is no longer hidden").

## Usage

Three steps: **open any session → click "Skill Switch" in the view tab bar → toggle with the inline
switch**. The panel applies per **project** that the session cwd belongs to; a toggle is written to
disk immediately, and the change takes effect on the **next model round** — no restart needed.

### Interface

A third tab is added to the session view tab bar (Conversation / Trace / **Skill Switch**; if
dsh-skills-manager is installed, it comes after the Skills manager). The panel has three parts:

!["Skill Switch" panel: filter chips and a search box on the left; each row has source/valid-error badges, the description, an inline switch and an "Actions" menu](<src/操作界面.png>)

- **Filter chips on the left**: All / Blocked (each with a count), plus a name + description search.
- **Left side of the card**: the name, the source badge, the **valid/error badge**, the description,
  and a line of facts (which of A/B/C failed the verdict, what the frontmatter is missing, that the
  name was taken from the directory name, the number of copies, that the name is invalid and cannot
  be switched, and so on).
- **Right side of the card**: a pure-CSS switch (one click is one toggle) + an "Actions" dropdown.
- **Actions menu**: "Repair frontmatter" (only for entries with frontmatter problems) and
  "Delete (all copies)"; both require a second confirmation and list the file paths that will be
  affected, one by one.

### Click a row → details (read-only)

Click the fact area on the left of the card (name / description) to open the detail page; "Back to
list" returns to the list (the filter and search term are kept). The switch and the "Actions" button
are not inside the fact area, so clicking them does not navigate away (rows with an invalid name that
cannot have a switch file written can still open their details).

![Detail view: description, verdict basis (conditions A/B/C, each yes/no), the root locations that exist (each copy's root / file / form / rank / whether it is loaded)](<src/skill 详情.png>)

The detail page does one thing only: "spread out the facts that are folded away in the list". Each
list row shows only the **winning copy** (the one with the lowest rank), so when skills of the same
name are scattered across the shared root / DSH root / library root, the detail page is the only
place to see the other copies — including each copy's **own** frontmatter issues (the same name can
have a different state in different roots), whether DSH will actually load it, and whether it can be
deleted. It **carries no write action at all** (block / delete / repair stay in the list).

The top of the page **no longer shows** the project's absolute path, the switch directory or `mode`:
those are internal implementation details the user cannot act on (the semantics of the switch
directory are still explained in the second confirmation for "Restore all for this item").

### Feature 1: project-level blocking

Switches live in the project's own `.dsh/skill-switches/`, travel with the repository and apply per
project:

```
<project root>/.dsh/skill-switches/
├── mode           # optional: first line "deny" (default) or "allow"
├── off/<name>     # deny mode: these skills are hidden
└── on/<name>      # allow mode: only these skills are visible
```

- **Per project**: within the same host process, a skill turned off in project A stays visible in
  project B.
- **Applies within the session**: changes are reflected in the session's skill catalog automatically
  on the **next round** — `dsh-tool-skill` calls `snapshot` with `{cwd: session.header.cwd}` on every
  `agent/pre-step`, and a changed digest rewrites the catalog in the system prompt, with no restart.
- **Fully hidden**: a skill that is turned off not only disappears from the catalog; loading it by
  name through the `skill` tool is intercepted too.

"Block/enable" in the panel has the same semantics under both modes (**whether it is hidden**):

| Mode | Block | Restore |
|------|------|------|
| `deny` (default) | create `off/<name>` | delete `off/<name>` |
| `allow` | delete `on/<name>` | create `on/<name>` |

In both cases any leftover of the same name on the other side is cleaned up along the way, so the
semantics don't drift after switching modes by hand.

"Restore all for this item" in the top right of the panel clears `off/` and `on/`; if the project is
currently in `allow` (allowlist) mode, it **also removes the `mode` file** — clearing only `on/` would
turn the allowlist into the empty set, which wipes the entire skill catalog and is exactly the
opposite of "restore the default visibility". The confirmation dialog says so explicitly.

You can still skip the UI entirely and just create the files (identical to v1):

```sh
cd <your project>
mkdir -p .dsh/skill-switches/off
echo "this project doesn't need it" > .dsh/skill-switches/off/ai-supply-chain-bottleneck-hunter
touch .dsh/skill-switches/off/api-design.md    # a .md suffix is accepted too
rm -rf .dsh/skill-switches                     # restore everything
```

### Feature 2: global deletion

"Delete (all copies)" removes that name's copies in **every known root**:

| Root | Source id | Deletable |
|----|---------|----------|
| `<project root>/.dsh/skills` | `project-dsh` | ✅ |
| `<project root>/.agents/skills` | `project-agents` | ✅ |
| `customSkillDirs` | `custom` | ✅ |
| `$DSH_HOME/skills` (`~/.dsh/skills`) | `user-dsh` | ✅ |
| `$DSH_AGENTS_HOME/skills` (`~/.agents/skills`) | `user-agents` | ✅ (can be made read-only with `allowSharedRootWrites: false`) |
| `$DSH_BUNDLED_SKILL_DIR` | `bundled` | ❌ shipped with the host app; deleting it breaks the installation |
| `$DSH_HOME/skill-library` | `library` | ✅ (dsh-skills-manager's canonical copy) |
| virtual skills registered by other providers | `runtime` / any | ❌ there is nothing on disk to delete |

**Being precise about scope**: the roots this plugin scans consist of "the project root of the
current session's cwd + user-level/shared/bundled/library", so **project-level copies of other
projects** (`<another project>/.dsh/skills`) are **not** in the scan scope — that is why the button
says "Delete (all copies)" and not "Delete (global)", and the confirmation dialog states this as well.
To make it disappear in another project too, go to a session in that project and delete it again (or
just delete that directory).

Safety boundaries:

- Paths are **all derived by the server-side scan**; the client can only pass a name. Every path to
  delete must pass the check "strictly inside the root it belongs to, and not the root itself";
  anything out of bounds gets a `403 forbidden`.
- A single failure within one deletion does not drag down the other copies; if none of the copies
  exists, it reports `404`.
- The `cwd` in the request is treated as a fallback **only when the host actually knows that session
  and its cwd has not been hydrated yet**; when the sessionId is unknown, the host process cwd is
  always used. Otherwise any caller could pair a non-existent sessionId with an arbitrary absolute
  path and make writes/deletes happen somewhere else.
- Method dispatch goes through `Object.hasOwn`: prototype members such as `constructor` / `toString`
  are returned as "unknown method" with a 404 and never hit the prototype chain.
- The error.message of `/skill-switch` is always **machine-facing English** (the wire layer); the
  panel produces localized copy from the wire code, so the Chinese UI never gets English details
  mixed in, and the English UI never gets Chinese mixed in either.
- After a successful deletion, the switch file for that name in the current project is cleaned up as
  well, so that "delete it and install it back" doesn't keep the old block along with it.

### Configuration

Override by id in the profile's `cordis.patch.yml`:

```yaml
- id: skill-switch
  config:
    switchesDir: .dsh/skill-switches   # switch directory, relative to the project root
    defaultMode: deny                  # deny | allow
    cacheTtlMs: 1000                   # fallback lifetime of the state cache (an mtime fingerprint hit invalidates immediately)
    forceRefreshOnGet: true            # whether the get() interception path bypasses the cache
    dshHome: ''                        # defaults to resolveDshHome() ($DSH_HOME or ~/.dsh)
    agentsHome: ''                     # defaults to $DSH_AGENTS_HOME or ~/.agents
    customSkillDirs: []                # extra skill roots (same as the official provider's custom layer)
    bundledSkillDir: ''                # defaults to $DSH_BUNDLED_SKILL_DIR
    allowSharedRootWrites: true        # false = ~/.agents/skills is read-only (doesn't touch Claude Code's shared root)
```

## Caveat: how the "valid / error" verdict is defined

**Valid = A it is in the catalog ∧ B the model can invoke it on its own ∧ C the user can invoke it
explicitly**; if any one fails = "error", and the panel spells out which one:

| Failing condition | Meaning | Panel copy |
|--------|------|----------|
| A `not-in-registry` | it is not in this session's skill registry → DSH will not load it | not in the skill registry (DSH will not load it) |
| B `model-not-invocable` | `invocation.modelInvocable === false` (`disable-model-invocation: true`) | the model cannot invoke it on its own (disable-model-invocation) |
| C `user-not-invocable` | `invocation.userInvocable === false` (`user-invocable: false`) | the user cannot invoke it explicitly (user-invocable: false) |

**A must be read in the session's observer scope.** The `scope` of `SkillRegistry.snapshot()` decides
which layers it reads (the official comment: "omitted reads the global layer alone"); in the desktop
profile the top-level `skill-filesystem` is `disabled`, and the real provider is registered on the
agent preset's standing scope. So the panel uses `ctx.agents.get(sessionId)` to get that session's
agent (in DSH **the agent object itself is its ScopeKey**: `scopeTarget(agent, agent)`) and then reads
with `snapshot({ cwd, scope: agent })` — otherwise it only sees the global layer (in a real
measurement only 3 bundled skills remained out of 37 rows), misjudging every user skill as an
"error".

When no active agent is available (archived / not-yet-hydrated sessions) or the catalog read fails,
the panel **does not show the verdict column**, and produces no error entry on the wire either:
rendering "I don't know" as "it is broken" is a lie.

### Why the official provider drops certain skills (the interpreter for an A failure)

`@deepseek-ai/dsh-skill-filesystem`'s `parseSkillFile()` requires the frontmatter to have both a valid
kebab-case `name` and a non-empty `description`, otherwise it **drops the whole entry**. The
consequence is that such skills are invisible in any panel that only looks at the runtime catalog —
the user can neither see them nor fix them.

This plugin scans the disk with the **same roots and ranks** as the official provider, but parses
each candidate leniently:

| Case | Official provider | This plugin |
|------|---------------|--------|
| missing `name` | dropped | listed, name falls back to the directory/file name |
| missing `description` | dropped | listed, description falls back to the first meaningful text in the body (skipping code fences) |
| no frontmatter | dropped | listed, the body serves as the description source as usual |
| YAML parse failure | dropped | listed, and the body can still be taken from after the fence |
| name is not kebab-case | dropped | listed, marked `invalid-name`, and the switch is disabled (no switch file can be written) |
| `name`/`description` is not a string (e.g. a number) | dropped | listed, reported as `missing-name` / `missing-description` per the official rule |
| invocation field invalid or a legacy key used | dropped | listed, marked `invalid-invocation` |

The verdict rule is **aligned word for word** with the official `parseSkillFile()`: only a non-empty
`string` counts as a present field (no trim, no converting numbers to strings),
`disable-model-invocation` / `user-invocable` only accept boolean / 1 / 0 / true / false / yes / no /
on / off, and a legacy key such as `disableModelInvocation` makes the whole entry invalid.

These `issues` are no longer a separate badge, but **evidence for an A failure**: a row renders as
`error · not in the skill registry (DSH will not load it) · frontmatter is missing description`. A row
that only says "error" without saying why is not actionable; and the previous version said "not in
effect · reason unknown" when evidence was insufficient, which already treated "I couldn't read it"
as a conclusion — both are gone.

"Repair frontmatter" still only changes the frontmatter (inserted at the top of the file if absent,
the whole block replaced if broken), leaving the body untouched; after the repair `issues` is empty
and the verdict flips to "valid".

## Architecture

```
host half (lib/index.js)
├── installSkillFilter()   decorates ctx.skills' snapshot/list/get
│     snapshot/list -> raw collection -> resolve project root from session cwd -> read switch directory -> filter
│     get(name)     -> check switch state first -> hidden entries return undefined -> otherwise pass through to the original get
└── /skill-switch/api/*    panel JSON API (POST, browser trust fence + in-root path constraints)
      panel.load / switches.set / switches.reset / skills.delete / skills.repair

client half (lib/client.js)
└── the "Skill Switch" tab in the conversation.view seat (session-scoped; the request scope rides on the seat)
```

- The switch state cache uses **mtime fingerprint + TTL as two conditions**: normally it invalidates
  immediately (modern file systems have nanosecond mtime), and file systems with coarse mtime fall
  back to the TTL (1 second by default).
- All file system errors degrade to pass-through + a warn log, and never affect the skill system
  itself.
- Uninstall (fiber dispose) really removes the wrapper and restores the original methods: teardown is
  registered as a cordis disposer (`ctx.effect(() => () => {…})`), not written in the effect body —
  the latter would "uninstall" the instant it is installed and leak the wrapper forever. Restoration
  assigns the function value captured before wrapping and does not rely on `===` comparison (cordis
  may hand out a different bound proxy each time a service property is read). `WRAP_TAG` is only
  cleared on uninstall, so the double-wrap protection for HMR/repeated loading stays effective for
  the whole lifecycle. A regression test against real cordis covers "after dispose `off/<name>` is no
  longer hidden".
- The route fence follows the same rules as the `/api` gateway (Host loopback or the trustedHosts of
  the connection line, cross-site markers rejected); it is DNS-rebinding/CSRF defense, not
  authentication.
- Panel requests go through the **unwrapped** registry, so a blocked skill is still displayed with
  `inCatalog: true` — "blocked" and "does not exist at all" are never conflated.

## Known limitations

- Filtering matches by skill **name** and does not distinguish the source (user-level, project-level,
  plugin-bundled and runtime-registered skills of the same name are all treated alike).
- Switch changes take effect on the **next model round** (semantics of the catalog re-rendering
  mechanism itself), and do not retroactively modify already-injected history messages.
- After a deletion/repair, the `SkillRegistry` catalog cache is refreshed by the provider's **file
  watcher** (`watch` in `dsh-skill-filesystem` is on by default). The panel's own facts come from a
  disk scan, so the verdict and the frontmatter facts are correct right away; if a deployment turns
  `watch` off, A in the verdict (whether it is in the registry) only catches up on the next catalog
  rebuild.
- A in the verdict depends on an **active agent**: when a session is archived/not hydrated the panel
  does not show the verdict column instead of calling every row an error — rather say nothing than
  say something wrong.
- Upgrading to 0.3 requires **restarting the host** (the host half is loaded at startup). If during
  the transition you only refresh the page without restarting, the client treats the missing `errors`
  field as empty and does not white-screen.
- The `skill-library` root does **not participate** in the runtime catalog (the official provider
  does not scan it), so a skill in the library shows up as "unassigned"; it is still cleaned up
  together by "global deletion", which is exactly part of "deleting it clean".
- Both deletion and repair follow library semantics: `fs.rm` on a symlink only removes the link
  itself (it does not follow it and delete the target's contents), and `writeFileAtomic` is a
  same-directory temp file + rename (replacing the link itself). Links inside a root cannot cause an
  out-of-bounds deletion, and a dedicated test pins this down.
- "Delete (all copies)" does not cover the project-level copies of **other projects** (see "Being
  precise about scope" above).
- The plugin needs a host restart before it first loads; after that, switch changes need no further
  restart.

## Version history

| Version | Contents |
|---|---|
| **0.4.0** | Detail view (click a row to see each on-disk copy's root/file/rank/deletability), "Back to list" moved to the right end of the row, `lib/` and the README tidied up for release |
| 0.3.0 | "valid / error" verdict (A ∧ B ∧ C) + reading the registry in the session's observer scope; removed the "not in effect" badge and filter facet |
| 0.2.0 | host + client two-half panel: session tab, one-click switch, global deletion, repair frontmatter; 135 tests |
| 0.1.0 | First version, pure file protocol: `.dsh/skill-switches/{mode,off/,on/}` decorates `ctx.skills` |

Per-change details in [`CHANGELOG.md`](CHANGELOG.md).

## Support this project

**The smallest step, the biggest effect — ⭐ [Click here to Star, 5 seconds](https://github.com/twenty-3rd/dsh-skill-switch)**
(top right of the page: `☆ Star` → `★ Starred`). It does three things at once:

- ⭐ **For yourself**: next time you reinstall DSH, change machines, or debug "how did that skill show
  up again", it is in the list you starred, **findable at a glance**, with no searching and no
  digging through chat logs.
- ⭐ **For this plugin**: a star is the cheapest signal that "someone still uses this". With stars I'm
  willing to keep following DSH releases, keep fixing bugs, keep loosening the boundaries; **with not
  a single one, it just rots in a corner** — that is the most honest source of maintenance motivation
  for an open-source project.
- ⭐ **For the next person**: there is almost no ready-made solution for DSH skill management, and one
  more star is one more chance for someone to find it and avoid a pitfall.

Others are just as welcome:

- 🐛 **Report issues / request features**: <https://github.com/twenty-3rd/dsh-skill-switch/issues>
  — pitfalls you hit during installation, questions about the verdict rule, boundaries you'd like
  loosened, all welcome as issues; even a single "I'm using it" is valuable.
- 📣 **Pass it on to someone else who uses DSH**: the DSH ecosystem is still small, and one share does
  more in practice than distributing it anywhere else.
- If you find the README saying something that doesn't match the code (verdict rule, known
  limitations), just point it out; this project's principle is "rather say nothing than say something
  wrong", and that kind of feedback has the highest priority.

## License

MIT, see [LICENSE](LICENSE).
