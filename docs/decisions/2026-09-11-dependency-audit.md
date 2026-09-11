# Dependency audit at v0.1

`npm audit --omit=dev` — the dependencies that ship to users — reports
**0 vulnerabilities**. flowreel's runtime tree is `playwright` and
`ffmpeg-static` only.

`npm audit` including devDependencies reports 5 (3 moderate, 1 high,
1 critical), all in the `vitest@2` transitive tree. None of that code is
installed by `npx flowreel` or ships in the published package.

The fix is `vitest@4`, a breaking major bump for the test runner. Deferred
because there is no user exposure, and a test-runner migration deserves its
own change with the full browser/ffmpeg suite verified against it rather than
being folded into a release commit. Tracked here so it is a decision, not an
oversight.
