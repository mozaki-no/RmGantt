import { describe, expect, it } from 'vitest';
import {
  dataRequestLabel,
  dataRequestsOverBudget,
  formatDataRequest,
  formatDataRequestReport,
  readBudgetMs,
  toDataRequestRecord,
  type DataRequestRecord
} from './dataRequestTiming';

const record = (overrides: Partial<DataRequestRecord> = {}): DataRequestRecord => ({
  label: 'initial load',
  url: 'http://127.0.0.1:3000/projects/ecookbook/canvas_gantt/data.json',
  status: 200,
  totalMs: 120,
  serverMs: 100,
  ...overrides
});

describe('dataRequestLabel', () => {
  it('separates the two data requests the smoke test issues', () => {
    expect(dataRequestLabel('http://127.0.0.1:3000/projects/ecookbook/canvas_gantt/data.json'))
      .toBe('initial load');
    expect(dataRequestLabel('http://127.0.0.1:3000/projects/ecookbook/canvas_gantt/data.json?member_projects_only=1'))
      .toBe('member_projects_only validation');
  });

  it('keeps its label when other query parameters are present', () => {
    expect(dataRequestLabel('http://127.0.0.1:3000/projects/ecookbook/canvas_gantt/data.json?tracker_ids=1&member_projects_only=1'))
      .toBe('member_projects_only validation');
    expect(dataRequestLabel('http://127.0.0.1:3000/projects/ecookbook/canvas_gantt/data.json?tracker_ids=1'))
      .toBe('initial load');
  });

  it('matches the endpoint under a Redmine sub-directory installation', () => {
    expect(dataRequestLabel('http://127.0.0.1:3000/redmine/projects/ecookbook/canvas_gantt/data.json'))
      .toBe('initial load');
  });

  it('ignores everything that is not a data request', () => {
    expect(dataRequestLabel('http://127.0.0.1:3000/projects/ecookbook/canvas_gantt')).toBeNull();
    expect(dataRequestLabel('http://127.0.0.1:3000/plugin_assets/redmine_canvas_gantt/build/main.js')).toBeNull();
    expect(dataRequestLabel('http://127.0.0.1:3000/canvas_gantt/data.json.map')).toBeNull();
    expect(dataRequestLabel('not a url')).toBeNull();
  });
});

describe('toDataRequestRecord', () => {
  const base = { label: 'initial load', url: 'http://example.test/canvas_gantt/data.json', status: 200 };

  it('reports total time from the request start and server time from the wait for the first byte', () => {
    const result = toDataRequestRecord({
      ...base,
      timing: { startTime: 1_700_000_000_000, requestStart: 5, responseStart: 905, responseEnd: 1_250 }
    });

    expect(result).toEqual({ ...base, totalMs: 1_250, serverMs: 900 });
  });

  it('reports unknown rather than a bogus number when Playwright could not measure a phase', () => {
    const result = toDataRequestRecord({
      ...base,
      timing: { startTime: 1_700_000_000_000, requestStart: -1, responseStart: -1, responseEnd: -1 }
    });

    expect(result).toEqual({ ...base, totalMs: -1, serverMs: -1 });
    expect(formatDataRequest(result)).toContain('in unknown (server unknown)');
  });
});

describe('formatDataRequestReport', () => {
  // The distinction issue #10 is about: a slow response and a hang have to
  // read differently, and both have to survive a timed-out run.
  it('marks a request that never responded as unfinished', () => {
    const report = formatDataRequestReport({
      completed: [record({ totalMs: 28_310, serverMs: 28_190 })],
      unfinished: [{ label: 'member_projects_only validation', url: 'http://example.test/canvas_gantt/data.json?member_projects_only=1' }]
    });

    expect(report).toContain('completed  initial load: HTTP 200 in 28310 ms (server 28190 ms)');
    expect(report).toContain('UNFINISHED member_projects_only validation: no response');
  });

  it('says so explicitly when no data request was seen at all', () => {
    expect(formatDataRequestReport({ completed: [], unfinished: [] }))
      .toContain('no Canvas Gantt data requests were observed');
  });
});

describe('dataRequestsOverBudget', () => {
  it('selects only the requests slower than the budget', () => {
    const fast = record({ label: 'fast', totalMs: 900 });
    const slow = record({ label: 'slow', totalMs: 1_001 });

    expect(dataRequestsOverBudget([fast, slow], 1_000)).toEqual([slow]);
    expect(dataRequestsOverBudget([fast, slow], 5_000)).toEqual([]);
  });

  it('does not count an unmeasurable request as over budget', () => {
    expect(dataRequestsOverBudget([record({ totalMs: -1 })], 1_000)).toEqual([]);
  });
});

describe('readBudgetMs', () => {
  it('accepts a positive integer', () => {
    expect(readBudgetMs('15000')).toBe(15_000);
  });

  it('treats unset, empty and malformed values as no budget', () => {
    expect(readBudgetMs(undefined)).toBeNull();
    expect(readBudgetMs('')).toBeNull();
    expect(readBudgetMs('   ')).toBeNull();
    expect(readBudgetMs('soon')).toBeNull();
    expect(readBudgetMs('0')).toBeNull();
    expect(readBudgetMs('-1')).toBeNull();
    expect(readBudgetMs('1.5')).toBeNull();
  });
});
