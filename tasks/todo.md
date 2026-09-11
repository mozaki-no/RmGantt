# Working tasks

## Done: remove the version-progress N+1 from the data endpoint

- Status: fixed on 2026-09-09 by `RedmineCanvasGantt::VersionProgressPreloader`.
- GitHub issue: #8.
- Evidence: [`docs/performance/2026-09-09-10000-issue-investigation.md`](../docs/performance/2026-09-09-10000-issue-investigation.md)
- The data endpoint now runs a constant 62 uncached queries at 1, 100, and
  1,000 issues; it ran 76, 484, and 4,084 before. The issue-load change below
  later raised that constant to 70; the spec asserts constancy across issue
  counts rather than the absolute figure.

## Done: rerun the 10,000-issue measurements

- Completed on the validation host after the version-progress fix.
- Single-request `data.json`: 28.310 seconds and 8,369 queries before; 9.684
  seconds and 72 queries after.
- The original 60-second Redmine smoke-test timeout now passes at 10,000
  issues. Payload size and browser completion results are recorded in the
  investigation document.

## Done: optimize the seven-second issue load

- GitHub issue #9. The 2026-09-11 comparison confirmed that explicit `preload`
  reduces the 10,000-issue median from 6.115 seconds to 2.034 seconds while
  returning the same 10,000 unique issues.
- Query count changes from 3 to 11 but remains constant at 1,000 and 10,000
  issues. Median Ruby object allocations fall by 59.6%.
- Evidence:
  [`docs/performance/2026-09-11-issue-load-strategy.md`](../docs/performance/2026-09-11-issue-load-strategy.md)
- `QueryStateResolver#issues_scope_for` now calls `preload` instead of
  `includes`. Coverage: the resolver spec asserts the load method directly, and
  `spec/lib/redmine_canvas_gantt/query_state_resolver_load_strategy_spec.rb`
  runs both strategies against real models and compares the serialized tasks.
- Re-measured on the validation host after deployment: `data.json` went from
  9.684 s / 72 queries to about 5.2 s / 80 queries, issue resolution from about
  6.1 s to 2.654 s. Backend specs pass there on PostgreSQL 16 (312 examples, 0
  failures, 11 pending).
- `tools/performance/compare_issue_load_strategies.rb` had to be fixed as part
  of this: it forced its preload arm by redirecting `includes`, which the
  deployed resolver no longer calls, so both arms silently ran preload. Each arm
  now redirects the method it does not want, and the script reports
  `comparison_valid: false` when both arms produce the same SQL shape.
- The fixed script then produced the first valid post-deploy comparison at
  10,000 issues: `includes` 5.935 s / 3 queries / 2 joined issue selects,
  `preload` 2.018 s / 11 queries / 0 joined issue selects, `comparison_valid:
  true`.

## Done: make the Redmine smoke test report per-request timing

- GitHub issue #10. A slow-but-successful response used to fail the same way a
  hang does.
- `spa/tests/e2e-redmine/redmine-smoke.pw.ts` now logs every Canvas Gantt data
  request as it completes (status, total ms, and the server's share of it), and
  an afterEach hook prints the report even when the test body timed out. A
  request that started and never responded is listed as UNFINISHED, which is
  what separates a hang from a slow endpoint.
- `CANVAS_GANTT_SMOKE_TIMEOUT_MS` sets the per-test timeout deliberately; the
  default stays 60 s for the fixture-sized CI suite. `CANVAS_GANTT_SMOKE_DATA_BUDGET_MS`
  optionally fails a request that is slower than the budget.
- The formatting and budget rules live in `spa/tests/e2e-redmine/dataRequestTiming.ts`,
  free of any Playwright import, and are unit tested.
- Verified against a real Redmine 6.1: a slow run reports
  `completed ... HTTP 200 in 205 ms`, and a stalled endpoint reports
  `UNFINISHED ... no response`, both alongside the timeout.
- At 10,000 issues on the validation host the test passes on the original
  60-second timeout (37.3 / 36.3 / 36.3 s). Its per-request lines showed the two
  data requests overlapping and contending for CPU, which is why each reports
  about 11 s of server time against a 5.2 s single-request profile.
- `CANVAS_GANTT_SMOKE_PROJECT`, `CANVAS_GANTT_SMOKE_LOGIN` and
  `CANVAS_GANTT_SMOKE_PASSWORD` point the test at a load-test project and
  account. The first load run had to patch the committed test to do this, which
  is exactly what stops a run being reproducible. The following run needed no
  edit: the test file's checksum after the run matched the deployed archive.
- The budget was exercised at 10,000 issues: 60,000 ms passes, 5,000 ms fails as
  an assertion naming both requests and their times, not as a timeout.
