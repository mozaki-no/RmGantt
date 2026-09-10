# 10,000-issue data endpoint investigation (2026-09-09)

## Status

The primary bottleneck is fixed and the 10,000-issue re-measurement is
complete.

The largest issue was an N+1 query in version progress serialization. On the
measured 10,000-issue data set, `DataPayloadBuilder#build_versions` spent 17.65
seconds and executed 4,252 uncached SQL queries. Of those, 4,000 were subtree
`SUM(estimated_hours)` queries triggered by `Issue#total_estimated_hours`.

`RedmineCanvasGantt::VersionProgressPreloader` now answers
`Version#completed_percent` and `Version#start_date` for every version at once
in three queries. See [Fix](#fix) below for what was verified and what still
needs the load environment.

The two secondary findings are tracked separately and are not addressed here:
the seven-second issue load (GitHub issue #9) and the smoke test's inability to
distinguish a slow response from a hang (GitHub issue #10).

No production code was changed while the measurements above were taken.

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
container and database were removed.

The backend suite has since been rerun from a fresh Redmine 6.1 / SQLite test
database while implementing the fix below: 307 examples, 0 failures, 11 pending
(the pending examples need the MySQL/MariaDB CI adapter for their READ
COMMITTED barrier). CI runs the same suite against Redmine 6.0, 6.1, and 7.0.

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

## Fix

`lib/redmine_canvas_gantt/version_progress_preloader.rb` calculates both
per-version values for the whole version list at once:

1. the closed `IssueStatus` ids;
2. one grouped range join over the issue nested set, giving every non-leaf
   fixed issue its visible subtree estimate in a single `SUM ... GROUP BY`;
3. one projection of the fixed issues of every requested version, from which
   the open/closed counts, the weighted progress, and the minimum start date
   are calculated in memory.

The arithmetic reproduces Redmine's `FixedIssuesExtension` rather than deriving
progress from the Canvas Gantt task array, because a version may be shared
across projects and may hold issues the current toolbar filters out. Counting
and weighting deliberately ignore issue visibility, exactly as Redmine does,
while the subtree estimate honours it. When the preloader raises — a Redmine
release changing these internals — it returns an empty result and
`build_versions` falls back to Redmine's own accessors, so the payload stays
correct and only loses the speed-up.

### Measured after the fix

`spec/controllers/canvas_gantts_data_performance_spec.rb` drives the real
`data.json` endpoint over three versions and 1, 100, and 1,000 issues, half of
them parents of the other half:

| Visible issues | Uncached queries before | Uncached queries after |
| ---: | ---: | ---: |
| 1 | 76 | 62 |
| 100 | 484 | 62 |
| 1,000 | 4,084 | 62 |

`spec/lib/redmine_canvas_gantt/version_progress_preloader_spec.rb` asserts
value parity against Redmine's own `Version#completed_percent` and
`Version#start_date` for an empty version, a fully closed version, mixed
estimated and unestimated issues, a parent issue whose estimate comes from its
subtree, a subtree containing an issue invisible to the current user, and a
version shared across projects. Both specs run against Redmine 6.0, 6.1, and
7.0 in CI.

### 10,000-issue validation-host re-measurement

The fix was deployed to the same persistent validation environment and the
single-request measurement was repeated:

| Metric | Before | After |
| --- | ---: | ---: |
| `data.json` wall time | 28.310 s | 9.684 s |
| Rails request-log SQL queries | 8,369 | 72 |
| Version serialization | 17.652 s / 4,252 uncached queries | 0.636 s / 4 uncached queries |
| Encoded payload | not recorded | about 8.53 MB |

The response retained 10,000 tasks, 5,990 relations, and 50 versions. Browser
JSON parsing took 47 ms. All 50 preloaded version-progress values were compared
with Redmine's accessors and had zero mismatches.

The Redmine smoke test then passed three times: 46.6 seconds, 45.6 seconds, and
56.7 seconds. The final run used the original 60-second test timeout that had
failed before the fix. There were no page errors, browser console errors,
failed scripts, or failed build assets.

A fresh segment profile on 2026-09-11 measured version serialization at
0.316–0.535 seconds and four uncached queries across three runs. The next
largest segment remained issue resolution; its dedicated `includes` versus
`preload` comparison is recorded in
[`2026-09-11-issue-load-strategy.md`](2026-09-11-issue-load-strategy.md).

## Recommended implementation plan

The plan below is kept as written; every step except the final re-measurement
is done.

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
7. Rerun the 10,000-issue HTTP and Playwright measurements. Done on the
   validation host; see [10,000-issue validation-host
   re-measurement](#10000-issue-validation-host-re-measurement).

Do not calculate version progress from only the currently filtered Gantt issue
array. A version may contain issues excluded by the current toolbar/query
filters, and Redmine versions may be shared across project boundaries.

## Secondary optimization candidate

Tracked as GitHub issue #9. The follow-up comparison on 2026-09-11 confirmed
that issue resolution's three uncached queries include two wide eager-load
queries with every configured association joined. Explicit `preload` used 11
constant queries but reduced the 10,000-issue median from 6.115 seconds to
2.034 seconds and Ruby object allocations by 59.6%, while returning the same
10,000 unique issues. The query count stayed at 11 for both 1,000 and 10,000
issues.

See
[`2026-09-11-issue-load-strategy.md`](2026-09-11-issue-load-strategy.md) for
the method, individual samples, independent confirmation run, and recommended
implementation checks. This remains separate from the version-progress fix so
both changes stay independently reviewable.

The change has since landed: `QueryStateResolver#issues_scope_for` calls
`preload`, with resolver coverage for the load method and a real-model spec
comparing the serialized tasks under both strategies. The 10,000-issue endpoint
and browser numbers above therefore predate it and need one more run on the
validation host.

## Expected impact and completion criteria

Eliminating the version N+1 should remove roughly 17 seconds and more than
4,000 uncached queries from this data set. A preliminary target is a data
endpoint response below 10 seconds on the same host after the primary fix; this
is a measurement target, not a compatibility contract.

The work is complete when:

- [x] version progress values match Redmine for the edge cases above;
- [x] query count does not grow with issue count or parent count;
- [x] the standard backend specs pass on supported Redmine versions;
- [x] frontend build, lint, async-contract, and unit tests pass;
- [x] the Redmine-integrated smoke test passes at 10,000 issues;
- [x] the before/after HTTP time, query count, payload size, and browser
  completion time are recorded in this document.
