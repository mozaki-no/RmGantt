# Working tasks

## Done: remove the version-progress N+1 from the data endpoint

- Status: fixed on 2026-09-09 by `RedmineCanvasGantt::VersionProgressPreloader`.
- GitHub issue: #8.
- Evidence: [`docs/performance/2026-09-09-10000-issue-investigation.md`](../docs/performance/2026-09-09-10000-issue-investigation.md)
- The data endpoint now runs a constant 62 uncached queries at 1, 100, and
  1,000 issues; it ran 76, 484, and 4,084 before.

## Open: rerun the 10,000-issue measurements

- Needs the validation host described in the investigation document; CI has no
  10,000-issue data set.
- Record the before/after HTTP time, query count, payload size, and Playwright
  completion time in that document.

## Open: profile the seven-second issue load

- GitHub issue #9. `QueryStateResolver#issues_scope_for` uses `includes` with
  the bounded load; compare against explicit `preload` for the associations
  that no SQL predicate touches.
- Benchmark separately, after the 10,000-issue re-measurement above.

## Open: make the Redmine smoke test report per-request timing

- GitHub issue #10. A slow-but-successful response currently fails the same way
  a hang does.
