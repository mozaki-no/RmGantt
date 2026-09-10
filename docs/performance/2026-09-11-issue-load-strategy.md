# 10,000-issue load-strategy comparison (2026-09-11)

## Result

GitHub issue #9's suspected cause is confirmed. On the existing 10,000-issue
validation data set, replacing the `Issue` association load's `includes` with
explicit `preload` reduced median query-resolution time from 6.115 seconds to
2.034 seconds. That is a 66.7% reduction, or about 3.0 times faster.

The trade-off is deliberate: the query count rises from 3 to 11, but remains
constant between 1,000 and 10,000 issues. Both strategies returned exactly the
same number of unique issues.

No production code or validation data was changed during this measurement.

## Environment

- Plugin revision: `cfd1e23` (`main` at the start of the measurement)
- Redmine: 6.1.1.stable
- Rails: 7.2.3
- Ruby: 3.4.8
- Database: PostgreSQL 16
- Runtime: the existing official Redmine container under WSL2
- User: an existing administrator test user
- Data:
  - 10 projects
  - 10,000 issues
  - 5,990 issue relations

The deployed copies of `query_state_resolver.rb`,
`version_progress_preloader.rb`, and `profile_data_payload.rb` matched the
local `main` files by SHA-256 before the comparison.

## Method

`tools/performance/compare_issue_load_strategies.rb` runs the real
`QueryStateResolver#resolve` path. It changes only how the configured
associations are loaded:

- `includes`: the current production behavior;
- `preload`: an `ActiveRecord::Relation` extension redirects the final
  `includes` call to `preload` without editing production code.

Each strategy receives one warm-up run. Measured runs alternate strategy order
to reduce time-order bias, force `ActiveRecord::Base.uncached`, clear the Rails
query cache, and run GC immediately before timing. Cached, schema, and
transaction SQL events are excluded. The script also records returned and
unique issue counts, SQL shape, and Ruby object allocations.

Run from the Redmine root:

```bash
CANVAS_GANTT_PROFILE_PROJECT=canvas-load-01 \
CANVAS_GANTT_PROFILE_USER=admin \
CANVAS_GANTT_PROFILE_SAMPLES=5 \
bundle exec rails runner \
  plugins/redmine_canvas_gantt/tools/performance/compare_issue_load_strategies.rb
```

## Primary 10,000-issue comparison

Five measured samples followed one warm-up per strategy.

| Strategy | Median | Min–max | Uncached queries | Issue SELECTs | Issue SELECTs with `LEFT OUTER JOIN` | Median allocated objects | Returned / unique issues |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current `includes` | 6.115 s | 5.951–7.035 s | 3 | 2 | 2 | 1,806,213 | 10,000 / 10,000 |
| Explicit `preload` | 2.034 s | 2.012–2.066 s | 11 | 1 | 0 | 728,810 | 10,000 / 10,000 |

The five individual timings were:

| Sample | `includes` | `preload` |
| ---: | ---: | ---: |
| 1 | 7.035 s | 2.022 s |
| 2 | 6.461 s | 2.034 s |
| 3 | 6.115 s | 2.012 s |
| 4 | 5.951 s | 2.066 s |
| 5 | 5.951 s | 2.047 s |

Explicit preload reduced median allocated objects by 59.6%. The current path
executes one `SELECT DISTINCT issues.id` query and one very wide eager-load
query; both join every configured association. Explicit preload instead runs
one narrow Issue query and one query per association family.

## Independent confirmation

A second process repeated the 10,000-issue comparison with three measured
samples:

| Strategy | Median | Min–max | Queries | Median allocated objects |
| --- | ---: | ---: | ---: | ---: |
| Current `includes` | 6.149 s | 6.099–7.354 s | 3 | 1,806,214 |
| Explicit `preload` | 2.145 s | 2.017–2.172 s | 11 | 728,810 |

This independent run showed a 65.1% median reduction, consistent with the
primary run.

## Query-count scaling check

The same script was run against `canvas-load-02`, which contains 1,000 issues
and no child projects. Three measured samples followed one warm-up per
strategy.

| Issues | Strategy | Median | Min–max | Queries | Returned / unique issues |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | Current `includes` | 0.582 s | 0.575–0.601 s | 3 | 1,000 / 1,000 |
| 1,000 | Explicit `preload` | 0.220 s | 0.219–0.221 s | 11 | 1,000 / 1,000 |
| 10,000 | Current `includes` | 6.115 s | 5.951–7.035 s | 3 | 10,000 / 10,000 |
| 10,000 | Explicit `preload` | 2.034 s | 2.012–2.066 s | 11 | 10,000 / 10,000 |

The query counts are constant across this tenfold increase in issues. The
remaining time scales with rows and Ruby object materialization, not with an
N+1 query.

## Conclusion and next step

The measurement supports replacing `includes` with explicit `preload` for the
associations used only during task serialization. The implementation should
remain a separate change for GitHub issue #9 and should include:

1. resolver coverage proving the intended association-load method;
2. task-payload parity coverage;
3. the existing 1/100/1,000 issue query-count regression;
4. a fresh 10,000-issue endpoint and browser measurement after deployment.

## Implementation

`QueryStateResolver#issues_scope_for` now ends with `preload(*@issue_includes)`
instead of `includes(*@issue_includes)`. Nothing else changed: every filter in
that method compares a plain `issues` column, and sorting runs in Ruby over the
loaded records, so no SQL predicate references the associations and none of
them needs to be joined.

`DataPayloadBudget#load_records` still bounds the load. It reads `limit + 1`
records and raises when the count exceeds the limit, so a truncated result is
never served under either strategy and the arbitrary subset an unordered
`LIMIT` would pick cannot reach the payload.

Coverage added with the change, against the checklist above:

1. `spec/lib/redmine_canvas_gantt/query_state_resolver_spec.rb` asserts that the
   resolver calls `preload` and never `includes`. A joined eager load and a
   preloaded load are indistinguishable in the result, so the strategy has to
   be asserted as a call rather than inferred from the records.
2. `spec/lib/redmine_canvas_gantt/query_state_resolver_load_strategy_spec.rb`
   resolves the same real issues under both strategies — the second through a
   relation extension that redirects `preload` back to `includes`, the mirror
   image of the measurement script — and compares the issue set and the
   serialized task state of every issue. It also asserts that reading each
   preloaded association costs no query, and that the two strategies really do
   produce different SQL, so a revert cannot leave the parity examples passing
   against two runs of the same strategy.
3. `spec/controllers/canvas_gantts_data_performance_spec.rb` is unchanged and
   still gates query-count growth at 1, 100, and 1,000 issues. It asserts that
   the count is equal across those sizes rather than equal to a fixed number,
   so the higher constant this change introduces does not weaken the gate. On
   that fixture-sized data the endpoint went from 62 to 70 uncached queries,
   constant at all three sizes under both strategies - the same eight extra
   queries the 3-to-11 change shows at 10,000 issues.

Item 4 remains outstanding: it needs the validation host, which holds the only
10,000-issue data set. Rerun the segment profile and the Playwright load run
there and record the numbers in
[`2026-09-09-10000-issue-investigation.md`](2026-09-09-10000-issue-investigation.md).
