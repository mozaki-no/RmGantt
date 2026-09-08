# Working tasks

## High priority: remove the version-progress N+1 from the data endpoint

- Status: open; root cause confirmed on 2026-09-09.
- Evidence and handoff: [`docs/performance/2026-09-09-10000-issue-investigation.md`](../docs/performance/2026-09-09-10000-issue-investigation.md)
- Primary location: `RedmineCanvasGantt::DataPayloadBuilder#build_versions`.
- Measured cost: 17.65 seconds and 4,252 uncached queries for 50 versions
  across 10,000 issues.
- Required regression: prove query count stays constant at 1, 100, and 1,000
  issues while preserving Redmine version-progress semantics.
- After the primary fix, profile explicit association `preload` as a separate
  optimization for the seven-second issue-load segment.
