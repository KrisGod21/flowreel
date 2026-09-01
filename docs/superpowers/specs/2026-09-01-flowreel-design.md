# flowreel — Design Spec

- **Date:** 2026-09-01
- **Repo:** https://github.com/KrisGod21/blastradius (to be renamed `flowreel`)
- **Status:** Approved, pending implementation plan
- **Supersedes:** `2026-09-01-blastradius-design.md`

## One-liner

Record a polished demo of your web app by clicking through it once.

## Problem

Every project needs a demo animation. Hackathon submissions, README files, pull
request descriptions, portfolios, Product Hunt launches. It is the single
highest-leverage asset a project has, and producing one today is miserable:

- Screen recorders produce 40MB files that blow past README size limits
- A real mouse cursor looks jerky and amateur on playback
- Text is illegible once a 1440p app is scaled down to README width
- Recordings capture dead time while the app loads
- The moment the UI changes, the whole recording must be redone by hand

`vhs` solved exactly this problem for terminal apps and earned roughly 15k
stars doing it. Nothing equivalent exists for web apps. The closest tool,
`screencli`, sits at 10 stars, so the lane is validated and unclaimed.

## Users

Anyone shipping something with a UI: hackathon teams, open source maintainers,
students, indie developers, designers. No account, no API key, no server.

## Guiding principle

**User-friendliness outranks power.** The main reason `vhs` stays niche is that
it requires learning a DSL before you get anything. flowreel inverts this: the
DSL exists, but almost nobody should have to write one by hand.

Three tiers, and a user can stop at any of them:

| tier | command | who it is for |
|------|---------|---------------|
| 0 | `npx flowreel` | first-timers — detects a dev server or an existing script and guides from there |
| 1 | `flowreel record` | most people — click through the app, get a demo and a generated script |
| 2 | edit the `.reel` file, re-run, wire into CI | maintainers who want regenerable demos |

## `flowreel record` — the headline feature

Opens the app in a browser. The user clicks, types and scrolls exactly as a
human would. On exit, flowreel writes both the finished demo and the `.reel`
script that reproduces it.

This removes the DSL from the critical path entirely. Playwright already
provides the codegen machinery for translating real interactions into
selectors, so the work is post-processing that output into `.reel` syntax and
adding timing.

The generated script is the on-ramp to tier 2: users learn the syntax by
reading a script of their own session rather than a manual.

## The `.reel` script

```
visit http://localhost:3000
viewport 1280x800

click "Sign in"
type "#email" "demo@example.com"
caption "One command, zero setup"
zoom "#dashboard"
scroll down

output demo.gif --preset github-readme
```

### Commands in v1

| command | notes |
|---------|-------|
| `visit <url>` | |
| `viewport <w>x<h>` / `device <name>` | named device frames |
| `click <text or selector>` | |
| `type <target> "<text>"` | realistic per-character timing |
| `press <key>` | |
| `hover <target>` | |
| `scroll <up\|down\|to <target>> [amount]` | |
| `wait <ms \| target \| idle>` | |
| `zoom <target>` / `reset zoom` | smooth transition |
| `highlight <target>` | |
| `caption "<text>"` | burned-in overlay text |
| `theme <light\|dark>` | |
| `output <file> [--preset <name>]` | `.webp`, `.gif`, `.mp4`, `.webm` |

### Plain-English targets

`click "Sign in"` matches visible text first, then ARIA role and label, and
falls back to CSS only when the text is ambiguous. Requiring CSS selectors is
the difference between a tool a designer can use and one they cannot.

## The polish layer

The automation is not the product. Driving Playwright is twenty lines of code.
What earns a star is what comes out the other end:

- **Synthetic cursor** that glides between targets on an eased path, with click
  ripples and keystroke chips. Never a real mouse capture.
- **Auto-zoom** onto the active element so a 1440p app is legible at README width
- **Dead-time trimming** — idle gaps over a threshold are collapsed automatically
- **Captions** burned in, turning a silent clip into an explainer
- **Framing** — browser chrome, device frames, rounded corners, drop shadow, gradient backdrop
- **Size targeting** — encoding that hits a byte budget for the chosen destination

### Key technical decision: overlays are injected, not composited

The cursor, ripples, captions, highlights and zoom are injected into the page as
DOM and CSS, so the browser renders them and the capture picks them up natively.

There is no frame-by-frame compositing step. This is dramatically less code,
pixel-accurate by construction, resolution-independent, and is the single reason
this project is finishable by one person.

## Output formats: why GIF is the default, and why it should not be forever

GIF is a bad format. 256 colors, no interframe compression, files routinely
5-10x larger than an equivalent H.264 encode. It is the default for exactly one
reason: **it is the only format that reliably autoplays inline in a GitHub
README from a repo-relative path.**

The alternatives fail on that specific constraint:

- **MP4 / WebM.** GitHub markdown does not accept relative paths for video. The
  file must be uploaded through GitHub's web editor and is stored outside the
  repository, with no autoplay and no looping. This also breaks CI
  regeneration outright, since a build step cannot update a file that does not
  live in the repo. Fine for docs sites and social, unusable for a README.
- **Animated WebP.** Roughly 3.5x smaller than GIF at equivalent quality
  (~2.3MB versus ~8.2MB for a 720p clip) with full color instead of 256, and it
  appears to render inline on GitHub.
- **AVIF.** Around 15x smaller than GIF, but rendering support is less certain.

**Open question, resolved in milestone 1.** Sources conflict on whether GitHub
reliably renders animated WebP inline. This is a cheap empirical test: publish
a WebP, a GIF and an AVIF to a scratch repo and check rendering on the GitHub
web UI, the GitHub mobile app, and the npm package page. If WebP passes,
`github-readme` defaults to WebP with a GIF fallback flag. If it fails, GIF
stays the default. This must not be guessed at.

### Presets are keyed by destination, not format

The user should say where the demo is going, not what codec it needs:

| preset | format | dimensions | target size |
|--------|--------|-----------|-------------|
| `github-readme` | WebP or GIF, pending the test above | 900px wide, 15fps, looped | under 5MB |
| `docs` | WebM with MP4 fallback | 1280px wide | under 10MB |
| `twitter` | MP4 | 1280x720 | under 15MB |
| `producthunt` | GIF | 1270px wide | under 3MB |

Presets set format, width, framerate and byte budget together. The encoder
reduces framerate and palette size until the budget is met, then reports the
final size.

A preset may be named in the script's `output` line or passed as a CLI flag.
The CLI flag wins, so a checked-in script can be re-rendered for a different
destination without editing the file. `output demo.gif` with an explicit
extension always overrides the preset's format choice.

## Zero-flag defaults

Running `flowreel` with no arguments must never produce a usage error. It:

1. Looks for a `.reel` file in the current directory
2. If none, scans common dev ports (3000, 5173, 8080, 4200, 8000)
3. If a server is found, offers to start recording
4. If nothing is found, prints one sentence explaining what to do next

Defaults: `github-readme` preset, output named `demo` with the preset's
extension, dead time trimmed,
zoom automatic. Flags exist for people who want control, not as a requirement.

## Error handling

Errors state the fix in plain language, never a stack trace:

> Nothing is running at localhost:3000 — start your dev server first, maybe `npm run dev`?

> Couldn't find "Sign in" on the page. Visible buttons: "Log in", "Register".

The second form matters most: a failing selector should list what *was* found.

**Exit codes:** `0` success, `1` script or runtime error, `2` internal error.

## Architecture

Node 20+, TypeScript, one npm package. Playwright drives Chromium, CDP
screencast pulls frames, `ffmpeg-static` encodes.

| module | responsibility | testable in isolation |
|--------|----------------|----------------------|
| `parser/` | `.reel` source to a typed `Script` | pure function, golden files |
| `runtime/` | executes a `Script` against a Playwright page | against a bundled demo app |
| `overlay/` | injected cursor, ripples, captions, zoom | browser-side CSS/DOM, snapshot tested |
| `capture/` | CDP screencast to a frame sequence | frame count and dimensions |
| `encode/` | frames to WebP/GIF/MP4/WebM, presets, byte budgeting | size and dimension assertions |
| `record/` | live session to generated `.reel` source | interaction log to script, pure |
| `cli/` | flags, zero-arg flow, error presentation | snapshot tested |

**Data flow:** `.reel` source -> `Script` -> runtime + overlay -> frames ->
encoder -> output file.

`record/` runs the same pipeline in reverse: interactions produce a `Script`,
which is then serialized to `.reel` source and executed normally. Recording and
playback therefore share one code path, so a recorded script always replays.

### The Chromium problem

Playwright bundles roughly 150MB of Chromium, which is punishing for an `npx`
tool where first-run time is the whole first impression.

Mitigation, in order: use the system Chrome or Edge install if present via
Playwright's `channel` option; otherwise prompt before downloading, with a clear
size estimate. This is the biggest install-friction risk in the project and is
addressed in milestone 1, not deferred.

## Testing

Vitest.

- **Parser:** golden-file tests, source to serialized AST. Every command gets a valid and an invalid case.
- **Runtime:** executed against a small static demo app bundled in the repo, so tests need no network and no user project.
- **Overlay:** DOM snapshot assertions on the injected markup.
- **Encoder:** asserts dimensions, frame count and that output lands within the preset byte budget. Exact bytes are not asserted, since ffmpeg builds differ across platforms.
- **Record:** a recorded interaction log must serialize to a script that parses and replays identically. This round-trip is the core invariant.

## Distribution

- npm, primary path `npx flowreel`
- `action.yml` makes the repo a GitHub Action that regenerates demos on release, so READMEs never show a stale UI
- README with a demo that is itself produced by flowreel, checked in CI

The self-demonstrating README is a deliberate launch asset. The product proves
itself in the first two seconds of the page.

## Risks

| risk | mitigation |
|------|------------|
| Chromium download kills first-run experience | Prefer system Chrome/Edge; prompt with size before downloading |
| Output looks amateur, defeating the whole point | The polish layer is the product; treat visual quality as a v1 requirement, not a nicety |
| Output file sizes exceed README limits | Byte-budgeted encoder that degrades framerate and palette until it fits; WebP preferred over GIF if it renders |
| Recorded selectors are brittle | Prefer visible text and ARIA roles over CSS paths when generating scripts |
| Scope creep into a video editor | Non-goals are explicit; no GUI, no timeline, no audio in v1 |

## Non-goals for v1

- Audio or voiceover
- A GUI or timeline editor
- Terminal recording (`vhs` owns this)
- Any hosted service, account, or telemetry
- Mobile device emulation beyond viewport and frame

## Milestones

1. Skeleton, `.reel` parser, golden-file harness, browser resolution and the Chromium decision, and the WebP-on-GitHub rendering test that sets the default output format
2. Runtime and capture: script executes, frames come out
3. Encoder with presets and byte budgeting — end to end output from a hand-written script
4. Overlay layer: cursor, ripples, captions, zoom, framing
5. `flowreel record` and script generation
6. Zero-arg flow, friendly errors, `--watch`
7. GitHub Action, self-demonstrating README, launch
