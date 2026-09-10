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
