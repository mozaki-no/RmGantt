# Working tasks

## Done: remove the version-progress N+1 from the data endpoint

- Status: fixed on 2026-09-09 by `RedmineCanvasGantt::VersionProgressPreloader`.
- GitHub issue: #8.
- Evidence: [`docs/performance/2026-09-09-10000-issue-investigation.md`](../docs/performance/2026-09-09-10000-issue-investigation.md)
- The data endpoint now runs a constant 62 uncached queries at 1, 100, and
  1,000 issues; it ran 76, 484, and 4,084 before.

## Done: rerun the 10,000-issue measurements

- Completed on the validation host after the version-progress fix.
- Single-request `data.json`: 28.310 seconds and 8,369 queries before; 9.684
  seconds and 72 queries after.
- The original 60-second Redmine smoke-test timeout now passes at 10,000
  issues. Payload size and browser completion results are recorded in the
  investigation document.

## Measured: optimize the seven-second issue load

- GitHub issue #9. The 2026-09-11 comparison confirmed that explicit `preload`
  reduces the 10,000-issue median from 6.115 seconds to 2.034 seconds while
  returning the same 10,000 unique issues.
- Query count changes from 3 to 11 but remains constant at 1,000 and 10,000
  issues. Median Ruby object allocations fall by 59.6%.
- Evidence:
  [`docs/performance/2026-09-11-issue-load-strategy.md`](../docs/performance/2026-09-11-issue-load-strategy.md)
- The production change and its regression coverage remain open.

## Open: make the Redmine smoke test report per-request timing

- GitHub issue #10. A slow-but-successful response currently fails the same way
  a hang does.
