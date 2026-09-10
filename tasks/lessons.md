# Project lessons

## Large data payloads

- Preloading the main `Issue` collection does not guarantee query-constant
  serialization. Methods on auxiliary records can hide issue-level queries.
  In particular, Redmine's `Version#completed_percent` walks fixed issues and
  calls `Issue#total_estimated_hours`, which performs a subtree `SUM` for every
  non-leaf issue.
- Performance regression coverage must measure the whole data payload,
  including versions, custom fields, permissions, and relations. A query-count
  assertion around only issue loading or spent-hours loading is insufficient.
- Preserve Redmine's version-progress semantics when batching calculations.
  Do not derive version progress solely from the currently filtered Canvas
  Gantt task array; shared versions and filtered-out issues still matter.
- Distinguish HTTP completion from an E2E timeout. The load smoke test performs
  two large data requests, so its 60-second timeout can expire even when both
  requests return HTTP 200. Record per-request server timing as well as total
  browser-test time.
- Do not assume `includes` will issue separate preload queries. On the bounded
  10,000-issue relation, Rails chose a distinct-ID query plus a wide joined
  eager load. Inspect the actual SQL before selecting an association strategy.
- A larger constant query count can be faster than a smaller one. Explicit
  preload used 11 queries instead of 3 but cut issue resolution by about two
  thirds and allocations by about 60%; keep query-count checks focused on
  growth with issue count, not on minimizing the absolute number alone.
- A spec that compares two association-loading strategies has to force the
  other one, and prove it forced it. Both strategies return the same records by
  design, so a parity spec that does not assert differing SQL keeps passing
  after a revert, comparing two runs of the same strategy.
- Diagnostics for a timeout have to be emitted before the timeout, not
  collected at the end of the test. A Playwright test body stops at its
  timeout, so per-request numbers are logged as each request completes and the
  summary is printed from an afterEach hook; anything gathered only after the
  last assertion is exactly what a timed-out run loses.
- Record what did not finish, not only what did. Timing a completed request
  says an endpoint was slow; only the list of requests still in flight says it
  hung. Track requests from the `request` event and remove them on
  `requestfinished` / `requestfailed`, so whatever remains is the hang.
- A measurement tool that forces a code path is invalidated by the change it
  measured. `compare_issue_load_strategies.rb` forced its preload arm by
  redirecting `includes`; once the resolver itself called `preload`, both arms
  measured preload and agreed to within 0.01 s. Any harness that overrides a
  production call must assert that the override took effect, and say so in its
  output, because the failure looks like agreement rather than like an error.
- A committed test that a load run has to edit before it can run is not
  reproducible. Take the project identifier and credentials from the
  environment, defaulting to the CI fixture values, so the same file serves both.

## Redmine model internals in serialization

- Redmine's `Version#completed_percent` and `Version#start_date` are lazy
  per-version calculations, and the first one hides one visible subtree `SUM`
  per non-leaf fixed issue. Any payload that serializes a version list needs a
  bulk calculation, not a preloaded association.
- The nested set makes a per-parent subtree aggregate a single grouped range
  join (`parents.root_id = issues.root_id AND issues.lft >= parents.lft AND
  issues.rgt <= parents.rgt`). Reach for that before writing a per-record loop.
- Reproducing a Redmine calculation means reproducing its visibility rules
  exactly, and they are not uniform: `Version#completed_percent` counts and
  weights *all* fixed issues, while the `Issue#total_estimated_hours` it calls
  honours `Issue.visible`. Cover both halves with a parity spec that compares
  against Redmine's own accessor on a freshly loaded record, since Redmine
  memoizes progress on the instance.
- When a bulk reimplementation replaces a Redmine accessor, let it fall back to
  that accessor on any error. A future Redmine release changing the internals
  then costs speed, not correctness.
