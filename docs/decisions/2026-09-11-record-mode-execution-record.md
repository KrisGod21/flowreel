# Record mode execution record - rulings and deferred findings

From the Plan 3 execution ledger (gitignored workspace, would otherwise be lost at merge).

Plan: `docs/superpowers/plans/2026-09-11-flowreel-record-mode.md`

## Rulings

### Ruling R1: Task 2's raw-mode test must pass `{ polish: false }` once Task 3 makes polish the default. The plan says so in Task 3 Step 4; carrying it into the Task 3 dispatch explicitly. Cost if wrong: none.

### Ruling R2: In-page timestamps are performance.now() relative to each document's time origin, and the session rebases them as pageEpoch + at, which double-counts the document's load time by roughly the load duration. Accepted: every gap is clamped into [250, 1200]ms before becoming a wait, so a few hundred ms of skew is absorbed and the order of events is preserved. Cost if wrong: a wait after a slow navigation clamps to 1200 slightly more often than it should.

### Ruling R3: `serialize` emits `visit` URLs bare, so `http://x/page#section` re-parses as `http://x/page` — the unquoted `#` starts a comment. Verbatim from my plan; ruling for the finding, because hash-routed URLs are common in exactly the apps this records and the round-trip invariant is the task's whole purpose. Fix: quote the URL. Also carrying the reviewer's forward warning into Task 4's dispatch: `KeyboardEvent.key` for the space bar is a literal `' '`, which `press` cannot emit bare; the recorder's press set must exclude it or normalise it. Cost if wrong: none; quoted URLs already parse.

### Ruling R4: Two of my Task 3 tests contradict each other. "Clears the caption before output" requires every polished script to end with `{kind:'caption', text:''}`; "does not caption a click whose label is empty or long" filters ALL captions and asserts the list does not contain `''`. The second test's intent is that no caption is generated FOR those clicks; it accidentally also asserts against the intentional trailing clear. Fix: the test must look at the commands before the trailing `caption "" / wait / output` triple — `script.commands.slice(0, -3)`. The implementation is untouched. Cost if wrong: none; this only narrows what the test inspects to what it was always meant to inspect.

### Ruling R5: Fixing both Importants and one Minor. (1) Title captions: strip trailing brand segments by splitting on " - ", " | ", " — ", " · " and keeping the leading segment before the length check; raw document.title is boilerplate on most real sites. (2) Caption persistence: buildScript tracks whether a caption is showing and inserts `caption ""` before any event that emits none while one is active, so a click's caption reads as a subtitle for that click and does not linger through a zoomed typing sequence. (3) ZOOM_MAX_WIDTH_FRACTION 0.4 -> 0.3; 512px is an ordinary full-size input, not a small control, and zooming it looks like a camera bump. Deferring the navigate-gets-no-wait gap: a click-driven demo tool rarely sees a typed-URL navigation. Cost if wrong: captions clear slightly more eagerly than some users want; one edit in the generated script fixes any case.

### Ruling R6: (1) The recorder emits bare-text targets without checking uniqueness; `Overview` matches both `nav a` and `h1` on the demo page and resolves correctly only by DOM order. Fix: emit text only when exactly one visible element carries that exact normalised text (buttons are checked among buttons since the resolver tries `getByRole('button')` first; everything else among all elements); otherwise fall back to id / name / CSS path. (2) Two drifted "clickable ancestor" selector lists -> one constant. (3) Stop button at bottom-right collides with the demo app's own toast, and bottom-right is the most common toast corner in real apps. Move it to top-centre as a recording indicator. Also fixing the dead newline check, adding a genuine double-injection test (same document, second evaluate), and making the "does not steal clicks" test assert something real (the host's box is small). Cost if wrong: more targets fall back to CSS paths on pages with repeated labels, which replay correctly but read less nicely.

### Ruling R7: Fixing all three Importants in one commit. (1) `name`/`placeholder` attribute values are interpolated unescaped into the CSS fallback selector, so a placeholder containing `"` yields malformed CSS that fails at replay with a confusing not-found message. Escape `"` and `\` the way quote() does. (2) `__flowreelEvent` is a page-visible global with no payload validation; a foreign `type` falls through actionFor's switch to `[...undefined]` and aborts with a raw TypeError. Validate the shape at the boundary and drop anything malformed. (3) A click that opens a new tab is silently unrecorded. The .reel language has no tab switching, so recording it would replay wrongly; the honest v1 is a stderr warning when the context opens a new page. Cost if wrong: none for 1-2; for 3, a warning the user may not read.

### Ruling R8: The reviewer's strongest recommendation is that the resolver try getByRole('link') before getByText, so nav links whose text also appears in a heading keep readable text targets. Agreed, and it is the first follow-up after merge - but it is a resolver change touching replay behaviour that Plans 1 and 2 verified, so it gets its own small change with its own tests rather than riding in this branch's final commit.

## Deferred, still open

- Task 4+5: minor (deferred): the resolver tries getByRole('button') then getByText; links are not tried by role, so a link whose text also appears in a heading falls back to a CSS path. Adding getByRole('link') before getByText in resolveTarget would let the recorder keep text targets for links. Resolver change; not this plan.
- Resolver: try getByRole('link') before getByText so nav links keep text targets when a heading shares their text. First follow-up after merge.
- Title captions keep the leading segment, which assumes "Page - Brand" order; "Brand | Page" sites caption the brand.
- <select> changes are not captured, and the language has no command for them.
- Navigation error translation is duplicated between runtime/execute.ts and record/session.ts; extract one helper.
- A hard browser crash (no unload events) can drop the last field's pending typed value.
