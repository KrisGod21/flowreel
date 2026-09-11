# flowreel GitHub Action

Regenerate a demo GIF/MP4 whenever you push, and commit the result back into the repo.

## Usage

```yaml
- uses: KrisGod21/flowreel@v0.2.0
  with:
    script: demo/demo.reel
    start: npm run dev        # optional: a command to start the app first
    url: http://localhost:3000   # optional: waited on before recording
```

A full workflow, running on every push to main:

```yaml
name: demo

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  regenerate:
    runs-on: ubuntu-latest
    steps:
      - uses: KrisGod21/flowreel@v0.2.0
        with:
          script: demo/demo.reel
          start: npm run dev
          url: http://localhost:3000
```

The `permissions: contents: write` block is required so the action's own `git push` step can commit the regenerated files.

## Inputs

| Name     | Required | Default | Description |
|----------|----------|---------|-------------|
| `script` | yes      | (none)  | Path to the `.reel` script to run, relative to the repo root. |
| `start`  | no       | `''`    | A command to start the app before recording, e.g. `npm run dev`. Runs in the background; the action does not wait for it to exit. |
| `url`    | no       | `''`    | A URL to poll before recording starts. The action waits up to 60 seconds for it to respond, then fails with a plain message if it never does. |
| `commit` | no       | `true`  | Set to `false` to skip committing and pushing the regenerated demo files. |

## What it does

1. Checks out the repository.
2. Sets up Node 20.
3. Runs `npm ci` if `package-lock.json` exists.
4. If `start` is set, runs it in the background.
5. If `url` is set, waits up to 60 seconds for it to respond.
6. Runs `npx playwright install --with-deps chromium`.
7. Runs `npx flowreel <script>` from the directory the script lives in.
8. If `commit` is not `false`, commits any changed `*.gif`, `*.mp4`, or `*.webp` files next to the script and pushes, using `git config user.name`/`user.email` set from `github.actor` and the workflow's built-in `GITHUB_TOKEN`.

## Caveat: no system Chrome on the runner

GitHub-hosted runners do not ship a system Chrome, so this action downloads a fresh copy of Chromium (about 150MB) on every run unless you cache Playwright's browser directory. Add a cache step before the `flowreel` action to avoid paying that cost each time:

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: ${{ runner.os }}-playwright-chromium

- uses: KrisGod21/flowreel@v0.2.0
  with:
    script: demo/demo.reel
```

The action still runs `playwright install --with-deps chromium` every time; with the cache in place that step finishes quickly instead of downloading the browser again.
