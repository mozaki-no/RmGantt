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
