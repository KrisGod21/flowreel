# Decision: README image format (Task 10)

**Status: DECISION NOT YET FINAL.** `README_IMAGE_FORMAT` in `src/encode/presets.ts`
remains `'gif'` — the safe default — until the GitHub-rendering verification in
the "Pending" section below is actually performed. Nothing in this document
authorizes changing that constant; see that section for what's still open.

## What this covers

This is the *local* half of Task 10: producing the three candidate files from
one browser recording and measuring them. The *publish* half (push candidates
to GitHub, observe whether each renders inline) has not been done and is a
separate decision for the repo owner, since it requires pushing to a real
GitHub repo.

## How the candidates were produced

Built the project (`npm run build`) and ran:

```
node dist/cli.js <script>.reel --preset github-readme
```

against the fixture app at `test/fixtures/app/index.html`, once with
`README_IMAGE_FORMAT` left as `'gif'` and once temporarily set to `'webp'`
(reverted immediately after measuring, confirmed via `git diff` to be
byte-identical to HEAD before committing). AVIF isn't wired into any preset,
so it was produced by running the bundled ffmpeg (`ffmpeg-static`, path from
`node -e "console.log(require('ffmpeg-static'))"`) directly against the same
captured JPEG frames, with `-c:v libaom-av1 -still-picture 0`. This build has
`libaom-av1` and an `avif` muxer (`ffmpeg -encoders` / `-muxers`), so AVIF was
testable.

## Important finding: the brief's exact script produced a degenerate capture

The brief's script (`.tmp/scratch.reel`) is:

```
visit file:///D:/PROJECT%20MANIA/start-project/test/fixtures/app/index.html
viewport 900x600
wait 300
click "Sign in"
wait 800
output candidate
```

Running this through the real pipeline, the CDP screencast captured only 3
raw frames, spanning ~250-460ms, and **all 3 are byte-identical** (verified by
MD5). Separately confirmed with a standalone Playwright script that the click
*does* register and the `#dashboard` element genuinely becomes visible (class
`shown` is present after the click, and a `page.screenshot()` taken
afterward shows it). So the DOM change is real, but no further
`Page.screencastFrame` event arrives to capture it within the recording
window — screencast frame emission appears to need continued compositor
activity (in a follow-up test, adding a `scroll down` after the click
produced two visually distinct frame groups, confirming a scroll nudges the
next frame loose). This looks like a real gap in the capture pipeline
(Task 8/9's territory, out of scope here), not anything specific to image
format encoding.

The consequence for this task: encoding 3 identical frames as GIF still
produces a nominally multi-frame, looping GIF file (ffmpeg's GIF encoder does
not deduplicate). But encoding the same 3 identical frames with
`libwebp_anim` produced a **plain, non-animated, single-frame WebP** (verified
below) — `libwebp_anim` apparently collapses an all-duplicate frame sequence
down to a static image rather than emitting a degenerate animation. AVIF's
`libaom-av1`, by contrast, kept all 3 (identical) frames and produced a
properly animated (`avis` brand) AVIF container.

Because a size comparison against a WebP that isn't actually animated would
be measuring the wrong thing, two data sets are reported below: the
**official** one (brief's exact script, as instructed) and a **supplementary
motion** one (a script with a `scroll down` added after the click, so the
capture contains genuinely distinct frames) used only to get a meaningful
size ratio. The official numbers are the ones that matter for "what does
running the tool's own documented recipe produce"; the motion numbers are
the ones that matter for "is the ~3.5x/~15x claim in the right ballpark."

## Official candidates (brief's exact script)

| Format | Bytes | Notes |
|---|---|---|
| GIF  | 17,679 | 3 frames, all identical content (see above) |
| WebP | 3,366  | **Not animated** — single `VP8 ` chunk, no `ANIM`/`ANMF` chunks (libwebp_anim collapsed the duplicate-frame input) |
| AVIF | 3,114  | 3 frames, `avis` (animated) brand kept even though content is identical |

These are real, reproducible numbers from this exact recipe, but the WebP
number is not a valid stand-in for "an animated WebP of this clip" — there is
no animated WebP of this clip, because the clip has no visible motion in what
was captured.

## Supplementary candidates (motion confirmed, not part of the official recipe)

Same fixture app, same `github-readme` preset, but with `scroll down` and a
longer wait added after the click so the capture contains genuinely different
frames (confirmed distinct by MD5 on the raw JPEG frames before encoding):

| Format | Bytes | Frames |
|---|---|---|
| GIF  | 38,000 | 11 (resampled to 15fps) |
| WebP | 7,688  | 3 (animation frames, confirmed below) |
| AVIF | 5,214  | 11 |

### Size ratios (from the motion set — the valid comparison)

- GIF / WebP = 38,000 / 7,688 ≈ **4.94x** (WebP ~79.8% smaller)
- GIF / AVIF = 38,000 / 5,214 ≈ **7.29x** (AVIF ~86.3% smaller)
- WebP / AVIF = 7,688 / 5,214 ≈ **1.47x**

Directionally consistent with the brief's "~3.5x for WebP" (this run measured
larger, ~4.9x) but well short of "~15x for AVIF" (this run measured ~7.3x).
Sample size is one very short (well under 1s), low-frame-count, low-motion
clip from a static fixture page, so these ratios should be treated as
order-of-magnitude, not precise — real demo recordings (more motion, more
frames, longer duration) may compress differently in either direction.

## Evidence the WebP candidate is genuinely animated (motion set)

`ffmpeg`'s own `webp_pipe` demuxer only decodes the *first* frame of an
animated WebP (a known limitation of that demuxer, not evidence about the
file) and this build ships no standalone `ffprobe`, so frame count was
verified instead by parsing the WebP RIFF container directly: walking the
top-level chunks by their declared sizes and counting `ANMF` (animation
frame) chunks, and checking the `VP8X` header's ANIM flag bit and the
presence of an `ANIM` chunk. Script: `.tmp/check-webp-anim.mjs` (not
committed — scratch tooling under the gitignored `.tmp/`).

Result for the motion WebP candidate:

```
Top-level chunks: VP8X(10B), ANIM(6B), ANMF(3370B), ANMF(2330B), ANMF(1920B)
VP8X ANIM flag set: true
ANIM chunk present: true
ANMF (animation frame) chunk count: 3
CONCLUSION: ANIMATED with 3 frames
```

This method was cross-checked against two controls: a synthetic 10-frame
`testsrc` clip (correctly reported 10 `ANMF` chunks) and the official
(duplicate-frame) candidate above (correctly reported 0 `ANMF` chunks / not
animated), so the same script categorizes both a clearly-animated and a
clearly-static WebP correctly before being trusted on the real candidate.

AVIF frame counts were verified with `ffmpeg -i <file> -f null -`, which
(unlike the WebP demuxer) decodes all frames of an AVIF and reports the true
count in its summary line; both the official (3) and motion (11) AVIF frame
counts matched the number of input frames exactly.

## Pending: GitHub rendering verification

**None of the following have been checked.** This is the entire reason
`README_IMAGE_FORMAT` has not been changed. Per the brief's Step 2, these six
yes/no questions require pushing the candidates to a scratch branch on the
real GitHub repo and observing behavior there — that is a publish action and
is left for the repo owner to decide on and carry out separately.

1. Does the animated WebP autoplay inline in a README on the GitHub **web UI**? — **unanswered**
2. Does it autoplay in the GitHub **mobile app**? — **unanswered**
3. Does it render on the **npm package page**? — **unanswered**
4. Does the GIF autoplay inline in a README on the GitHub **web UI**? (expected: yes) — **unanswered**
5. Does the GIF autoplay in the GitHub **mobile app**? (expected: yes) — **unanswered**
6. Does the GIF render on the **npm package page**? (expected: yes) — **unanswered**

## Current state of the constant

`README_IMAGE_FORMAT` in `src/encode/presets.ts` is `'gif'` and stays that
way as part of this commit. Per the brief's Step 4: it only becomes `'webp'`
if WebP is confirmed to render everywhere in the list above; if it fails
anywhere, it stays `'gif'`. Since none of the six checks have been run yet,
`'gif'` is the only value consistent with the evidence gathered so far.

## Files produced (not committed — scratch, under gitignored `.tmp/`)

- `.tmp/official/scratch.reel`, `.tmp/official/candidate.{gif,webp,avif}`
- `.tmp/motion/motion.reel`, `.tmp/motion/candidate.{gif,webp,avif}`
- `.tmp/check-webp-anim.mjs`, `.tmp/capture-frames.mjs` (diagnostic tooling written for this task)
