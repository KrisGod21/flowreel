# Plan 1 execution record — rulings and deferred findings

Extracted from the subagent-driven execution ledger, which lived under the
gitignored `.superpowers/` workspace and would otherwise have been lost at merge.
Preserved because the deferred findings are real work someone must pick up, and the
rulings are decisions taken on the repo owner's behalf that they may want to reverse.

Branch: `feat/core-pipeline` · Plan: `docs/superpowers/plans/2026-09-01-flowreel-core-pipeline.md`

## Rulings

### Ruling R1: Use branch `feat/core-pipeline` instead of a git worktree — sole developer, no concurrent work, and a worktree forces a duplicate `npm install` plus a second ~150MB Playwright browser download. Cost if wrong: none material; the branch is isolated from main and can be rebased or discarded.

### Ruling R2: Task 1's `.gitignore` must additionally include `.superpowers/`. The plan omits it and the SDD workspace lives there. Cost if wrong: scratch ledger and review packages get committed to the repo.

### Ruling R3: `FrameSet.width/height` are read at screencast start, so they disagree with reality when a script sets `viewport` afterwards. Accepted for Plan 1 — the encoder scales from `spec.width` and never reads these fields. Deferred minor. Cost if wrong: informational dimensions only; no output file is affected.

### Ruling R4: `tsc --noEmit` typechecks only `src` (tsconfig `include`), so `test/` is not typechecked. Accepted — vitest surfaces test type errors at runtime. Deferred minor. Cost if wrong: a type error in a test file is caught later than it could be.

### Ruling R5: `src/cli.ts` has no `#!/usr/bin/env node` shebang, so the published `flowreel` bin would not execute on Unix. The reviewer graded it Minor because the brief mandates that exact file content, but it breaks the primary install path (`npx flowreel`). Decision: add the shebang in Task 9, which replaces `src/cli.ts` wholesale — carried into that dispatch. Cost if wrong: none; a shebang is inert on Windows and required on Unix.

### Ruling R6: The Important finding (system Chrome detection misses the per-user install at %LOCALAPPDATA%\Google\Chrome\Application\chrome.exe) is labeled plan-mandated because the path list came verbatim from my plan. I rule for the finding. The spec is the binding authority and it requires preferring an installed browser so `npx flowreel` does not trigger a ~150MB Chromium download; the plan's hardcoded path list was illustrative, not a constraint, and as written it defeats the task's entire purpose for a real subset of Windows users. Fix dispatched. Cost if wrong: a slightly longer path list that checks two extra locations — no behavioural risk.

### Ruling R7: Folding the Minor (hardcoded `C:\Program Files` instead of deriving from %ProgramFiles%) into the same fix, because it is the same code region and the same root cause — assuming default install locations. Converting the path table into a pure function over an injected env fixes both and makes the detection unit-testable for the first time. Cost if wrong: marginally more code than the Important alone strictly required.

### Ruling R8: PLAN DEFECT confirmed empirically. The plan's Task 5 Step 3 code (`import ffmpegPath from 'ffmpeg-static'`) does not compile under this project's tsconfig. Root cause is upstream: ffmpeg-static@5.3.0 ships a .d.ts using ESM `export default` while its index.js does `module.exports = binaryPath` and the package sets no "type": "module", so under NodeNext every static import form resolves to the wrong type. The first Task 5 reviewer asserted the plain form compiles cleanly; the re-review disproved that with actual compiler output, and also disproved my own repetition of it in the round-1 fix message. Decision: keep the implementer's `createRequire` approach (it is the correct remedy) and require an explicit `: string | null` annotation to restore static checking. Cost if wrong: a hand-written type annotation could drift from the package's real runtime contract if ffmpeg-static changes its export shape — mitigated by the comment recording why the annotation exists.

### Ruling R9: The plan file's Task 5 Step 3 code block is now known-wrong. Not amending the plan mid-execution — the ledger and the committed code are the record, and rewriting a plan under execution invalidates the briefs already generated from it. Flagged for the final review instead. Cost if wrong: anyone re-running this plan from scratch hits the same compile error and has to rediscover R8.

### Ruling R10: PLAN DEFECT confirmed — the brief's Step 1 test code cannot run as written. The implementer's diagnosis is correct and its remedy works, so the deviation is accepted rather than reverted. Open question routed to review: whether a custom matcher plus a setup file is proportionate for a single assertion, given Vitest 2.x ships `expect.poll` built in. Cost if wrong: a small amount of bespoke test infrastructure that future tasks may copy.

### Ruling R11: The Important finding (resolveTarget matches on DOM presence, not visibility, so a hidden element can be selected and the follow-on click throws a raw Playwright TimeoutError with a stack trace) is plan-mandated — it is verbatim from my brief. I rule for the finding and fix it inside Task 7. The spec's error-handling rule ("Errors state the fix in plain language, never a stack trace") is binding, and target semantics belong to the resolver, not to Task 9's CLI error surfacing; leaving it would push an unowned error-translation obligation onto Task 9 and let it propagate. The same change also fixes the Minor where the "Visible buttons:" list can name hidden elements. Cost if wrong: a visibility filter could reject a target that is present but not yet painted, turning a slow-render case into a not-found error — mitigated because the resolver still throws a plain-language error naming what it did find.

### Ruling R12: Keeping the custom `toBeVisible` matcher rather than switching to Vitest's built-in `expect.poll`. The reviewer verified the matcher is correct — bounded 5s timeout, cannot hang, cannot false-pass — and judged the swap Minor. Rewriting working, verified test infrastructure mid-plan buys nothing. Recorded so the next Playwright task's brief specifies `expect.poll` instead, and this shim is not treated as precedent to extend. Cost if wrong: one bespoke matcher and a global setupFiles entry that later tasks may copy.

### Ruling R13: Rather than re-dispatch, the controller verified the abandoned working-tree fix empirically and committed it. Evidence gathered directly:

### Ruling R14: Accept the deviation. The defect is real and self-evident — the brief's code cannot pass the brief's own test. The spec's requirement is that the encoder "reduces framerate and palette size until the budget is met", i.e. a monotonically degrading ladder that terminates; the exact attempt indices were never a product decision. Routed to review for verification that the corrected ladder is monotonic, terminates, and never drops below 8fps. Cost if wrong: quality degradation could step in a different order than intended, changing output size/quality tradeoffs but not correctness.

### Ruling R15: The spec lists the `twitter` preset as "1280x720", but `OutputSpec` has no height field and the scale filter derives height from the source aspect ratio. I rule for the current behaviour: forcing a 720 height would letterback or crop an arbitrary viewport, which is worse than honouring the user's aspect ratio, and X accepts multiple aspect ratios. Treating the spec's "1280x720" as "1280px wide" is the better reading. Not adding a height field in Plan 1. The spec's wording should be corrected to "1280px wide" — flagged for the final review. Cost if wrong: X videos come out at the recording's aspect ratio instead of 16:9.

### Ruling R16: Fixing 2 Important findings plus one Minor (deriving MAX_ATTEMPTS from the ladder lengths). Including that Minor because it is the one that could silently become a real bug: MAX_ATTEMPTS=7 is currently unreachable, so a future ladder change would create a genuine early-stop or wasted-attempt inconsistency with nothing to catch it. Deferring the other three Minors. Cost if wrong: one extra line of scope in this fix round.

### Ruling R17: Accept both cross-task edits. Neither is scope creep: Task 9 is the first task that actually runs capture end to end and the first that encodes two outputs in parallel, so it is the first task where either defect could possibly manifest. (b) in particular is a real race my plan introduced by hardcoding the scratch path while also specifying `Promise.all` over the preset's outputs — the two requirements were mutually inconsistent. Routed to review for verification that the fixes are minimal and correct. Cost if wrong: edits to Task 6/7/8 files land under Task 9's review rather than their own.

### Ruling R18: Folding two Minors into the fix round. (i) The README snippet's alt text is the literal "demo" rather than the output basename, so `output shot` prints `![demo](shot.gif)`. It is plan-mandated and cosmetic, but it sits inside the paste-ready snippet, which is a headline feature — a visibly wrong artifact in the one thing the user copies. (ii) The end-to-end test asserts only a count plus `toContain('mp4')`, never that the other output is a gif; strengthening it directly verifies "one capture, two formats", the product claim that task exists to prove. Both are one-liners. Deferring the other two Minors (cross-process scratch collisions, exit-code-2 never empirically exercised). Cost if wrong: two extra lines of scope.

### Ruling R19: REVERSING R15. The final reviewer argued that the spec's preset table says "900px wide", "1280px wide", "1270px wide" and then, for `twitter` alone, "1280x720" — the one row where a height was deliberately specified, matching X's 16:9 autoplay. It also showed my ruling attacked an alternative nobody proposed: padding, not cropping, is the standard remedy and loses nothing. Most importantly it named a structural error I made — R15 amended the binding spec to match the implementation on a product question, where R6 and R11 correctly ran the other way. Decision: the spec's wording STAYS at 1280x720. No code change this merge; "twitter preset is width-only, 16:9 padding deferred" is recorded as a known Plan-1 gap. Cost if wrong: X videos ship at the recording's aspect ratio until a later plan adds a pad filter.

### Ruling R20: REVERSING R9. Deferring the plan-file correction was right during execution but its reason expired when execution ended. The decisive fact I failed to weigh: the plan is committed under docs/ and merges, while the ledger holding the correction lives under gitignored .superpowers/ and does not. Merging as-is would ship a checked-in document containing code empirically proven not to compile, with the correction deleted. Fixing the plan file in this wave.

### Ruling R21: The ledger itself does not survive the merge — .superpowers/ is gitignored (R2), so every ruling R1-R21 and every deferred Minor disappears at merge. Preserving them in docs/decisions/ as part of this fix wave. Also noting R16's process defect, raised by the reviewer: it deferred "the other three Minors" from Task 8 without naming them, so they are unrecoverable. Recording that as a lesson rather than pretending otherwise.

## Deferred findings, still open

- Task 1: minor (deferred): `npm audit` reports 5 vulnerabilities (1 critical) in the playwright/ffmpeg-static transitive tree. Not implementer error. Must be triaged before npm publish (Plan 4), not before Plan 1 merges.
- Task 1: minor (deferred): tsconfig `include: ["src"]` leaves test/ and vitest.config.ts untypechecked — see Ruling R4.
- Task 2: minor (deferred): an empty quoted argument ("") yields an empty-string token rather than being dropped. Controller note: emitting the token is the behaviour we want (typing an empty string is meaningful), so this is documentation-only, not a defect.
- Task 3: minor (deferred): `scroll down abc` yields `amount: NaN` and `wait -5` is read as a CSS target, instead of a plain-English error. Not brief-mandated behaviour; low cost to add later.
- Task 3: minor (deferred): the wrapped "Unterminated quote" message is forwarded verbatim from tokenize and does not suggest the fix.
- Task 4: minor (deferred): the "does not emit undefined" test covers only the chrome channel with a fully-empty env; no msedge equivalent and no mixed-env case. Code paths are symmetric, so no live bug.
- Task 6: minor (deferred): task-6-report.md describes gap capping as "independent" when the verified behaviour is cumulative. Report narrative only; code and tests are correct.
- Task 6: minor (deferred): `resampleToFps` assumes its input already starts at timestamp 0 (true after trimIdle, which is the designed call order) but no comment states that precondition.
- Task 9: minor (deferred): screencast.ts's compositor "nudge" flips documentElement.style.colorScheme and never restores it. Inert for the visit-first usage pattern (the nudge fires on about:blank and any `visit` discards that document), but a script with no `visit` would carry the mutation into the recording. Should restore in stop().
- Task 10: concern (deferred to final review): the brief's scratch script captured no real motion on the fixture — the click reveals #dashboard mostly below the fold, so the compositor produced no new frame. Needs confirming that this is a fixture/script artifact and not a capture defect that would affect real recordings.

## Known gaps recorded by the final review

- `twitter` preset is width-only; 16:9 padding deferred (see Ruling R19).
- `docs` preset emits WebM only; the spec says "WebM with MP4 fallback".
- Ruling R16 deferred three Task 8 Minor findings without naming them, so they are
  unrecoverable. Recorded as a process lesson: name every deferred finding.
- `README_IMAGE_FORMAT` stays `'gif'`; see `2026-09-01-readme-image-format.md`.
