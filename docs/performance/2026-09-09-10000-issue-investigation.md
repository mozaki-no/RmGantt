# 10,000-issue data endpoint investigation (2026-09-09)

## Status

Open. The primary bottleneck is identified but not fixed.

The largest issue is an N+1 query in version progress serialization. On the
measured 10,000-issue data set, `DataPayloadBuilder#build_versions` spent 17.65
seconds and executed 4,252 uncached SQL queries. Of those, 4,000 were subtree
`SUM(estimated_hours)` queries triggered by `Issue#total_estimated_hours`.

No production code was changed as part of this investigation.

## Validation environment

- Redmine: 6.1.1
- Database: PostgreSQL
- Runtime: the official Redmine Docker image under WSL2
- Plugin revision under test: `df14f8d`
- Browser: Chromium from `mcr.microsoft.com/playwright:v1.58.1-noble`
- Node.js validation image: `node:22-bookworm`

Host names, user passwords, SSH material, and other machine-specific secrets
are intentionally not recorded in this repository.

## Load-test data shape

The persistent validation database contains a dedicated test hierarchy. The
data was kept after the test so that a follow-up agent with access to that
environment can rerun the measurements.

- 10 private projects: `canvas-load-01` through `canvas-load-10`
- `canvas-load-01` is the parent of the other nine projects
- 1,000 issues per project; 10,000 issues total
- 100 issue trees per project
- Each tree has 10 issues and three levels:
  - one epic/root
  - three phase children
  - two leaf tasks below each phase
- 1,000 issue roots and 9,000 child issues
- 5,000 `precedes` relations (five dependency edges per issue tree)
- 990 `relates` relations (between adjacent roots)
- 50 versions and 50 issue categories
- Dates, statuses, priorities, progress, and estimates are distributed across
  the data set

Post-seed integrity checks reported:

```text
projects=10
issues=10000
roots=1000
children=9000
relations=5990
precedes=5000
invalid_bounds=0
invalid_parentage=0
visible_issues=10000
versions=50
categories=50
```

Running the seed operation a second time returned `ALREADY_SEEDED` and did not
create duplicates.

## Test results

### Frontend static and unit validation

The following commands completed successfully in Node.js 22:

```bash
cd spa
npm ci
npm run build
npm run lint
npm run check:async-contract
```

The full parallel Vitest run reported 1,296 passing tests and four timeouts on
the loaded WSL host (three `GanttToolbar` tests and one `TaskStore` burst test).
The affected files were rerun with one worker and all 235 tests passed:

```bash
cd spa
npx vitest run src/components/GanttToolbar.test.tsx src/stores/TaskStore.test.ts --maxWorkers=1
```

Treat the four parallel timeouts as host-load-related unless they recur in an
unloaded environment. They were not assertion failures.

### Redmine integration smoke test

The existing Redmine smoke test passed against a small project in 5.9 seconds.

Against `canvas-load-01`, the default 60-second test timeout expired during the
test's second data request. The Redmine requests themselves returned HTTP 200;
the test performs both the SPA's initial request and an additional
`member_projects_only=1` validation request.

With a load-test timeout, it passed:

```bash
cd spa
REDMINE_BASE_URL=http://127.0.0.1:8081 \
REDMINE_TEST_USERNAME=<login> \
REDMINE_TEST_PASSWORD=<password> \
npx playwright test --timeout 180000 \
  -c playwright.redmine.config.ts \
  tests/e2e-redmine/redmine-smoke.pw.ts
```

Result:

```text
1 passed (1.2m)
```

The run had no page errors, browser console errors, failed scripts, or failed
build assets.

### Backend specs

A disposable Redmine 6.1/PostgreSQL RSpec environment was prepared, but the
full backend run was interrupted before it produced a final summary. Its
partial output must not be treated as a pass or failure. The disposable
container and database were removed. Rerun the backend specs from a fresh test
database before merging a fix.

## HTTP timing observed

A 10,000-issue request completed successfully but was slow:

```text
Completed 200 OK in 28310ms
ActiveRecord: 10491.3ms (8369 queries, 4060 cached)
GC: 1241.2ms
```

A second request completed in 28,452 ms with a comparable query count. This is
repeatable and is not explained by initial asset loading.

## Segment profile

`tools/performance/profile_data_payload.rb` separates the main server-side
steps and excludes cached, schema, and transaction SQL events. The measured
result was:

| Segment | Seconds | Uncached queries |
| --- | ---: | ---: |
| Query resolution and issue preload | 7.009 | 3 |
| Task serialization | 1.873 | 25 |
| Project custom-field discovery | 0.060 | 1 |
| Version serialization | 17.652 | 4,252 |
| Current project serialization | 0.021 | 8 |
| Relation load | 0.471 | 1 |

The Rails request log includes cached queries, while the profiler intentionally
does not. That explains the difference between 8,369 total request queries and
the smaller uncached total above.

## Primary root cause

`RedmineCanvasGantt::DataPayloadBuilder#build_versions` serializes every visible
version and calls:

```ruby
completed_percent: version.completed_percent
```

Redmine delegates this to `fixed_issues.completed_percent`. That implementation
loads/counts version issues and iterates them to calculate weighted progress.
For every non-leaf issue, `Issue#total_estimated_hours` executes:

```ruby
self_and_descendants.visible.sum(:estimated_hours)
```

The test data has exactly 4,000 non-leaf issues (1,000 epics plus 3,000 phases),
which produced exactly 4,000 repeated subtree `SUM` queries. The remaining
version queries came from per-version issue/status/count/start-date work.

This contradicts the README performance contract that the data endpoint query
count should stay small and independent of issue count. It is a product bug,
not a deployment-tuning problem.

## Recommended implementation plan

1. Add a focused version-progress preloader/calculator under
   `lib/redmine_canvas_gantt/`.
2. Load all data needed for the visible versions in a bounded number of queries.
3. Calculate each non-leaf issue's visible subtree estimate in bulk, using the
   issue nested-set columns or an equivalent linear-time in-memory traversal.
4. Calculate version open/closed counts, weighted progress, and start dates in
   batches, then have `build_versions` read the precomputed values.
5. Preserve Redmine's `Version#completed_percent` semantics exactly. In
   particular, test estimated and unestimated issues, open and closed statuses,
   empty versions, nested issues, issue visibility, and shared versions.
6. Add a real-model query-count regression proving that SQL count remains
   constant at 1, 100, and 1,000 issues. Do not merely stub
   `Version#completed_percent`.
7. Rerun the 10,000-issue HTTP and Playwright measurements.

Do not calculate version progress from only the currently filtered Gantt issue
array. A version may contain issues excluded by the current toolbar/query
filters, and Redmine versions may be shared across project boundaries.

## Secondary optimization candidate

Issue resolution uses only three uncached queries, but still takes about seven
seconds. The association load produced a very large joined query because
`QueryStateResolver#issues_scope_for` uses `includes` with the bounded/limited
load. After fixing version progress, compare this with explicit `preload` calls
for associations that are not used in SQL predicates.

This is secondary: it does not explain the query explosion, and it should be
benchmarked separately so that the primary fix remains small and reviewable.

## Expected impact and completion criteria

Eliminating the version N+1 should remove roughly 17 seconds and more than
4,000 uncached queries from this data set. A preliminary target is a data
endpoint response below 10 seconds on the same host after the primary fix; this
is a measurement target, not a compatibility contract.

The work is complete when:

- version progress values match Redmine for the edge cases above;
- query count does not grow with issue count or parent count;
- the standard backend specs pass on supported Redmine versions;
- frontend build, lint, async-contract, and unit tests pass;
- the Redmine-integrated smoke test passes at 10,000 issues;
- the before/after HTTP time, query count, payload size, and browser completion
  time are recorded in this document.
