# blastradius — Design Spec

- **Date:** 2026-09-01
- **Repo:** https://github.com/KrisGod21/blastradius
- **Status:** Approved, pending implementation plan

## One-liner

See the blast radius of what your AI agent just wrote, before you commit it.

## Problem

Developers now let coding agents write large volumes of code and review it
shallowly or not at all. The diffs are too big and arrive too fast. The
industry's answer is cloud SaaS pull-request review, which costs money,
requires a PR to already exist, and ships the code to a third-party server.

Nothing good exists for the moment that actually matters: the local working
tree, after the agent stops and before you commit.

Three concrete failure modes drive this:

1. **Hallucinated dependencies.** Roughly one in five AI-generated code samples
   references a package that does not exist. Attackers pre-register those names.
   The `unused-imports` npm package is a documented live case.
2. **Silent test erosion.** Agents delete or skip failing tests to make a task
   "pass."
3. **Scope creep.** Agents edit CI config, lockfiles, and environment files
   nobody asked them to touch.

## Users

Any developer using a coding agent (Claude Code, Cursor, Codex, Copilot) on a
git repo. No account, no signup, no API key, no server.

## Non-goals for v1

Explicitly out of scope, to be reconsidered only after launch feedback:

- LLM-based semantic review of any kind
- Languages beyond JavaScript/TypeScript and Python
- IDE or editor plugins
- Any hosted service, dashboard, or telemetry
- Automatic fixing or rewriting of code

## The eight checks

Every check is deterministic. No model calls. Severity drives the CI exit code.

| # | id | severity | detection |
|---|----|----------|-----------|
| 1 | `phantom-dep` | critical | New dependency in a manifest that returns 404 from the npm or PyPI registry |
| 2 | `suspicious-dep` | critical | Dependency exists but is under 90 days old, has under 1000 weekly downloads, or is within Damerau-Levenshtein distance 2 of a bundled top-1000 package name |
| 3 | `install-script` | critical | Newly added dependency declares `preinstall`, `install`, or `postinstall` |
| 4 | `secret-added` | critical | Added lines match known credential formats (AWS, GitHub, Stripe, Slack, private key headers, JWTs) or exceed an entropy threshold in an assignment context |
| 5 | `dangerous-exec` | warning | Newly introduced `eval`, `new Function`, `child_process.*`, `os.system`, `subprocess.*`, `pickle.loads` |
| 6 | `new-egress` | warning | New outbound request to a host string not present anywhere in the repo at HEAD |
| 7 | `test-erosion` | warning | Test files deleted, test cases removed, or `.skip` / `.only` / `xit` / `@pytest.mark.skip` added |
| 8 | `scope-creep` | info | Changes to `.github/`, CI config, `Dockerfile`, `.env*`, or lockfiles when no source file in the same directory tree changed |

Checks 5 and 6 are AST-driven (tree-sitter). Checks 1-3 are manifest-driven.
Checks 4, 7, 8 are line- and path-driven.

## Commands

```
npx blastradius              # scan working tree, open interactive review
npx blastradius --demo       # run against a bundled fake repo, no setup needed
npx blastradius --plain      # non-interactive text report
npx blastradius --json       # machine-readable, stable schema
npx blastradius --sarif      # SARIF for GitHub code scanning
npx blastradius --offline    # skip all registry lookups
npx blastradius --only <ids> # run a subset of checks
blastradius accept           # write current findings to baseline
blastradius init             # install the pre-commit hook
```

### Interactive review

Findings are grouped by severity, never by file — the ordering is the product.
Each finding shows `file:line`, a one-sentence plain-English explanation, and
why it matters. Keys: arrow to navigate, `d` to expand the hunk, `r` to revert
that hunk, `a` to accept, `q` to quit. Accepted changes are staged on exit.

### `--demo` is a growth feature, not a toy

Launch-day data shows 92% of a project's stars arrive within 48 hours. A
stranger evaluating the repo will not have a dirty working tree to point it at.
`--demo` runs the real engine against a bundled fixture repo containing a
planted phantom dependency and a deleted test, so the tool proves itself in
five seconds. The demo fixture doubles as a test fixture, so it cannot rot.

## Configuration and the baseline

The tool requires zero configuration to run. An optional `.blastradius.json`
holds a **baseline**: `blastradius accept` records the fingerprint of every
current finding, and subsequent runs report only findings not in the baseline.

This exists because false positives are the single largest risk to adoption.
Eight heuristics against real diffs will misfire, and a tool that cannot be
silenced gets uninstalled. Fingerprints are content-based, not line-based, so
they survive unrelated edits above them.

## Architecture

Node 20+, TypeScript, one npm package. Parsing uses `web-tree-sitter` (WASM,
not native bindings) so there is no compile step and installs do not break on
user machines. Install reliability outranks language purity.

| module | responsibility | depends on |
|--------|----------------|------------|
| `core/git` | spawn `git diff`, parse porcelain into a typed `ChangeSet` | git binary |
| `core/parse` | tree-sitter WASM to ASTs for JS/TS/Python, regex fallback on parse failure | — |
| `core/registry` | npm and PyPI lookups, on-disk cache, bundled top-1000 name list | network (optional) |
| `checks/*` | one file per check, each exporting `{ id, severity, run(ctx) => Finding[] }`, pure | ChangeSet, ASTs, registry |
| `core/engine` | run checks, collect, dedupe, sort, apply baseline | checks |
| `ui/tui` | Ink-based interactive review | engine output only |
| `ui/report` | plain, json, and sarif reporters | engine output only |
| `apply/` | revert-hunk and stage-accepted via generated patches and `git apply` | git |

The engine is pure and every UI is a consumer of its output. This is what makes
golden-file testing possible and lets new checks ship without interface churn.

**Data flow:** `git diff` -> `ChangeSet` -> parse -> run checks -> `Finding[]`
-> baseline filter -> (TUI | reporter) -> optional apply.

### Core types

```ts
type Severity = 'critical' | 'warning' | 'info';

interface Finding {
  checkId: string;
  severity: Severity;
  file: string;
  line: number;
  title: string;       // one line, plain English
  detail: string;      // why it matters
  hunkId: string;      // links finding to a revertable hunk
  fingerprint: string; // content-based, for the baseline
}
```

## Error handling

The governing rule is **never block the user**.

- A check that throws is caught and reported as degraded; the exit code is unaffected.
- Not a git repo, or no changes: friendly message, exit 0.
- Network unavailable: registry checks degrade to "unverified" and never hang. 2s timeout, results cached on disk.
- Nothing on disk is modified without an explicit keypress.

**Exit codes:** `0` when no critical findings exist — warnings and info alone
do not fail a build. `1` when any critical finding is present; this is what CI
keys on. `2` on tool error. A `--strict` flag promotes warnings to failures for
teams that want it.

## Testing

Vitest. Every check gets a positive and a negative fixture: a tiny real git
repo built in a temp directory on `D:` with a known diff applied. Golden-file
tests against `--json` output make refactors safe. TDD throughout — the check
list is a natural test-first structure, since each check's fixture defines it.

## Distribution

- Published to npm; primary install path is `npx blastradius`
- `action.yml` in the repo root makes it a GitHub Action that emits SARIF into code scanning
- `blastradius init` installs the pre-commit hook
- README with an animated demo GIF above the fold

## Risks

| risk | mitigation |
|------|------------|
| False positives destroy trust | Severity discipline, the baseline file, `--only`, and conservative thresholds tuned against real repos before launch |
| "This is just another linter" | Framing, ordering by risk rather than file, and the interactive revert flow are the product; a report alone would not be |
| tree-sitter WASM bundle size | Accepted; a few MB is normal for `npx` tools and avoids native-build failures |
| Registry rate limits | On-disk cache, batched lookups, graceful degradation to "unverified" |
| The niche gets crowded | Ship the full eight checks and both ecosystems; the existing slopsquatting tools each implement one check |

## Milestones

1. Skeleton, `core/git`, `ChangeSet` types, golden-file harness
2. Checks 1-3 (dependency family) plus `core/registry` — this alone is a working tool
3. Checks 4-8, `core/parse` for the AST-driven pair
4. Reporters: plain, json, sarif
5. Interactive TUI and `apply/`
6. Baseline, `init`, `action.yml`
7. Demo fixture, README, GIF, launch
