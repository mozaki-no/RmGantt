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

## Scroll and render cost with large task lists

- A component rendered inside `GanttContainer` re-renders on every scroll
  frame, because the container subscribes to `viewport`. Anything that maps the
  whole task list there (the hidden `A11yLayer` built 10,000 `<li>` aria labels)
  has to be `React.memo`ed on its own store inputs, or scrolling at 10,000 tasks
  spends 80–100 ms per wheel event re-rendering it.
- `useTaskStore()` without a selector subscribes to the whole store, including
  `viewport`, so the toolbar and its menus re-rendered on every scroll frame.
  Select the fields a component shows (`useShallow` + `pickKeys`) and read the
  viewport inside event handlers with `useTaskStore.getState()`. Keep whole-store
  subscriptions where render calls store getters that read other state (the
  workload store's `getOverloadCycleInfo`); a narrowed selector silently stops
  those re-renders.
- Measure a scroll regression by driving real wheel events in a browser with a
  page that has a height. The benchmark page's `#root` has no height, so its
  chart viewport collapses and scrolling looks free when it is not.
- React's `onWheel` is passive. A wheel handler that scrolls the chart must be a
  native `addEventListener('wheel', ..., { passive: false })` with
  `preventDefault()`, or the Redmine page scrolls with it.
- Size the Redmine root by measuring the page overflow after setting a first
  estimate. Paddings and margins below the chart are theme-dependent, and a page
  that overflows by even 24 px gets its own scrollbar next to the chart's.
- Loops that run once per task at load must stay O(n log n). Kahn's
  topological sort with an array queue that was re-sorted on every push and
  shifted at the head took 1.1 s at 10,000 tasks; use a heap. Working-day
  differences over a long project (critical-path slack against the project
  finish) must not walk day by day either: count full weeks arithmetically and
  apply calendar overrides with a sorted prefix sum. Keep a parity test against
  the day-by-day walk, including the `-0` it never returns.
- Do not mount one DOM element per task, even hidden ones. 10,000 `<li>` in the
  a11y list cost about 1 s of commit plus 0.4 s of first layout; window the list
  to the visible rows with overscan and keep the selected task in it.

## Custom field serialization

- `Issue#custom_field_values` builds a `CustomFieldValue` for every available
  field and a new `CustomValue` record for every field the issue has no value
  for. At 10,000 issues that construction was about 8 of the 10 seconds of the
  data request. For a persisted, unchanged issue with preloaded custom values the
  answer is the stored value or nil (Redmine applies the field default only when
  `set_custom_field_default?` is true), so read the stored values directly and
  fall back to the accessor for anything else.
- Check only `project_id_changed?` and `tracker_id_changed?` for that fast
  path, not `changed?`: those two decide whether Redmine applies defaults, and a
  full `changed?` walks every attribute and cost more than the lookup itself.
- Before comparing data-request timings across environments, record CPU model
  and `RubyVM::YJIT.enabled?`. The official Redmine images run without YJIT,
  which alone doubled the payload build time, and a 2012 laptop CPU made the
  same 10,000-issue request about six times slower than the dev container.

## Multi-tab timer E2E

- The tab that loses a simultaneous timer start shows the "another timer is
  running" notice, and its backdrop swallows later clicks. A test that races two
  starts has to dismiss that notice before it touches either tab again, and must
  wait for the revision it expects rather than read the session right after a
  concurrent action.
