// Per-request timing for the Canvas Gantt data endpoint, kept free of any
// Playwright import so the formatting and budget rules can be unit tested.
//
// GitHub issue #10: at 10,000 issues the smoke test hit Playwright's test
// timeout while both data requests returned HTTP 200. A hang and a slow
// endpoint produced the same report - one timeout, no numbers - so the report
// has to say, per request, whether it finished and how long it took.

/** The subset of Playwright's `Request.timing()` this module reads. */
export type RequestTiming = {
  /** Wall-clock start. Every other field is relative to it, or -1 if unknown. */
  startTime: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
};

export type DataRequestRecord = {
  label: string;
  url: string;
  /** null when the request finished without Playwright reporting a response. */
  status: number | null;
  /** Request start to response body complete. -1 when Playwright could not measure it. */
  totalMs: number;
  /** Request sent to first response byte: the part Redmine spends answering. -1 when unknown. */
  serverMs: number;
};

export type PendingDataRequest = {
  label: string;
  url: string;
};

const DATA_ENDPOINT_PATH = '/canvas_gantt/data.json';

const UNKNOWN_MS = -1;

/**
 * The label a data request is reported under, or null when the URL is not a
 * Canvas Gantt data request. The smoke test issues two: the SPA's own initial
 * load, and the `member_projects_only=1` validation fetch.
 */
export const dataRequestLabel = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!parsed.pathname.endsWith(DATA_ENDPOINT_PATH)) return null;

  return parsed.searchParams.get('member_projects_only') === '1'
    ? 'member_projects_only validation'
    : 'initial load';
};

const relativeMs = (timing: RequestTiming, field: keyof RequestTiming): number => {
  const value = timing[field];
  return typeof value === 'number' && value >= 0 ? value : UNKNOWN_MS;
};

const differenceMs = (from: number, to: number): number => (
  from === UNKNOWN_MS || to === UNKNOWN_MS ? UNKNOWN_MS : Math.round(to - from)
);

export const toDataRequestRecord = (
  { label, url, status, timing }:
    { label: string; url: string; status: number | null; timing: RequestTiming }
): DataRequestRecord => {
  const requestStart = relativeMs(timing, 'requestStart');
  const responseStart = relativeMs(timing, 'responseStart');
  const responseEnd = relativeMs(timing, 'responseEnd');

  return {
    label,
    url,
    status,
    totalMs: responseEnd === UNKNOWN_MS ? UNKNOWN_MS : Math.round(responseEnd),
    serverMs: differenceMs(requestStart, responseStart)
  };
};

const describeMs = (value: number): string => (value === UNKNOWN_MS ? 'unknown' : `${value} ms`);

const describeStatus = (status: number | null): string => (status === null ? 'no status' : `HTTP ${status}`);

export const formatDataRequest = (record: DataRequestRecord): string => (
  `${record.label}: ${describeStatus(record.status)} in ${describeMs(record.totalMs)} `
  + `(server ${describeMs(record.serverMs)}) ${record.url}`
);

/**
 * The whole point of the report: a request that started and never finished is
 * a hang, and a request that finished slowly is a slow endpoint. Both have to
 * be visible, including when the test itself timed out.
 */
export const formatDataRequestReport = (
  { completed, unfinished }: { completed: DataRequestRecord[]; unfinished: PendingDataRequest[] }
): string => {
  const lines = ['[canvas-gantt] data request report'];

  if (completed.length === 0 && unfinished.length === 0) {
    lines.push('  no Canvas Gantt data requests were observed');
    return lines.join('\n');
  }

  completed.forEach((record) => {
    lines.push(`  completed  ${formatDataRequest(record)}`);
  });
  unfinished.forEach((request) => {
    lines.push(`  UNFINISHED ${request.label}: no response ${request.url}`);
  });

  return lines.join('\n');
};

export const dataRequestsOverBudget = (
  records: DataRequestRecord[],
  budgetMs: number
): DataRequestRecord[] => records.filter((record) => record.totalMs > budgetMs);

/**
 * Reads an optional millisecond budget from the environment. Anything that is
 * not a positive integer is treated as unset rather than as zero, so a typo
 * cannot silently fail every request.
 */
export const readBudgetMs = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.trim() === '') return null;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
