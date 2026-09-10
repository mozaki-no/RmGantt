import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Request } from '@playwright/test';
import { adminLogin } from './helpers';
import {
  dataRequestLabel,
  dataRequestsOverBudget,
  formatDataRequest,
  formatDataRequestReport,
  readBudgetMs,
  toDataRequestRecord,
  type DataRequestRecord
} from './dataRequestTiming';

type ManifestEntry = {
  file?: string;
  css?: string[];
  assets?: string[];
  imports?: string[];
  dynamicImports?: string[];
};

const collectManifestAssetPaths = (manifest: Record<string, ManifestEntry>): string[] => {
  const references = new Set<string>();
  const visitedEntries = new Set<string>();

  const visit = (entryKey: string) => {
    if (visitedEntries.has(entryKey)) return;
    const entry = manifest[entryKey];
    if (!entry) return;
    visitedEntries.add(entryKey);

    [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])].forEach((reference) => {
      if (reference) references.add(reference);
    });
    [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])].forEach(visit);
  };

  Object.keys(manifest).forEach(visit);
  return [...references];
};

type TrackedDataRequest = { label: string; url: string; status: number | null };

// Module scope, and reported from an afterEach hook, so the numbers survive a
// timed-out test body - which is precisely the run that needs them (GitHub
// issue #10).
const completedDataRequests: DataRequestRecord[] = [];
const failedDataRequests: string[] = [];
const inFlightDataRequests = new Map<Request, TrackedDataRequest>();

test.beforeEach(() => {
  completedDataRequests.length = 0;
  failedDataRequests.length = 0;
  inFlightDataRequests.clear();
});

test.afterEach(() => {
  console.log(formatDataRequestReport({
    completed: completedDataRequests,
    unfinished: [...inFlightDataRequests.values()].map(({ label, url }) => ({ label, url }))
  }));
});

test('renders canvas gantt page in Redmine', async ({ page, baseURL }) => {
  const redmineBase = baseURL ?? 'http://127.0.0.1:3000';
  const relativeRoot = new URL(redmineBase).pathname.replace(/\/$/, '');
  const expectedAssetPrefix = `${relativeRoot}/plugin_assets/redmine_canvas_gantt/build/`;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedScriptResponses: string[] = [];
  const failedBuildAssetResponses: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  page.on('request', (request) => {
    const label = dataRequestLabel(request.url());
    if (label) {
      inFlightDataRequests.set(request, { label, url: request.url(), status: null });
    }
  });

  page.on('response', (response) => {
    const req = response.request();
    const tracked = inFlightDataRequests.get(req);
    if (tracked) {
      tracked.status = response.status();
    }

    const responsePath = new URL(response.url()).pathname;
    if (responsePath.startsWith(expectedAssetPrefix) && !response.ok() && response.status() !== 304) {
      failedBuildAssetResponses.push(`${response.status()} ${response.url()}`);
    }
    if (req.resourceType() !== 'script' || response.ok() || response.status() === 304) return;
    if (!response.ok()) {
      failedScriptResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  // requestfinished fires once the body is fully received, which is also when
  // Request.timing() is complete. Reading it here keeps the handler synchronous,
  // so a request is either recorded or still listed as in flight - never lost to
  // a pending promise when the test is cut short.
  page.on('requestfinished', (request) => {
    const tracked = inFlightDataRequests.get(request);
    if (!tracked) return;

    inFlightDataRequests.delete(request);
    const record = toDataRequestRecord({
      label: tracked.label,
      url: tracked.url,
      status: tracked.status,
      timing: request.timing()
    });
    completedDataRequests.push(record);
    // Emitted as it happens, so a later timeout still leaves the number behind.
    console.log(`[canvas-gantt] ${formatDataRequest(record)}`);
  });

  page.on('requestfailed', (request) => {
    const tracked = inFlightDataRequests.get(request);
    if (!tracked) return;

    inFlightDataRequests.delete(request);
    failedDataRequests.push(`${tracked.label}: ${request.failure()?.errorText ?? 'request failed'} ${tracked.url}`);
  });

  await adminLogin(redmineBase, page);

  await page.goto(`${redmineBase}/projects/ecookbook/canvas_gantt`);
  await expect(page.locator('#redmine-canvas-gantt-root')).toBeVisible();
  await expect(page.getByRole('heading', { name: '403' })).toHaveCount(0);

  const loadingText = page.getByText('Loading Canvas Gantt...');
  await expect(loadingText).toHaveCount(0);

  const memberProjectsResponse = await page.evaluate(async () => {
    const config = (window as Window & {
      RedmineCanvasGantt: { apiBase: string };
    }).RedmineCanvasGantt;
    const response = await window.fetch(`${config.apiBase}/data.json?member_projects_only=1`);

    return {
      status: response.status,
      payload: await response.json()
    };
  });

  expect(memberProjectsResponse.status).toBe(200);
  expect(memberProjectsResponse.payload).toHaveProperty('filter_options.projects');

  const buildAssetUrls = await page.locator('script[src], link[href]').evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('src') ?? element.getAttribute('href'))
      .filter((url): url is string => Boolean(url?.includes('/plugin_assets/redmine_canvas_gantt/build/')))
  );

  expect(buildAssetUrls.length).toBeGreaterThan(0);
  expect(buildAssetUrls.every((url) => url.startsWith(expectedAssetPrefix))).toBe(true);

  const manifestPath = fileURLToPath(new URL('../../../assets/build/.vite/manifest.json', import.meta.url));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, ManifestEntry>;
  const manifestAssetUrls = collectManifestAssetPaths(manifest).map((assetPath) => (
    new URL(`${expectedAssetPrefix}${assetPath}`, redmineBase).toString()
  ));
  const manifestAssetResponses = await page.evaluate(async (urls) => Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    return { url, status: response.status };
  })), manifestAssetUrls);

  expect(manifestAssetResponses.filter(({ status }) => (
    !(status >= 200 && status < 300) && status !== 304
  ))).toEqual([]);
  expect(failedBuildAssetResponses).toEqual([]);
  expect(failedScriptResponses).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  expect(failedDataRequests).toEqual([]);
  // The SPA's own load plus the member_projects_only fetch above. Asserting it
  // keeps the instrumentation honest: a URL-matching change that stopped
  // recording would otherwise leave an empty report and no failure.
  expect(completedDataRequests.length).toBeGreaterThanOrEqual(2);

  // Opt-in, so the fixture-sized CI suite is unaffected and the load run can
  // make "slow" fail as slow instead of as a timeout.
  const budgetMs = readBudgetMs(process.env.CANVAS_GANTT_SMOKE_DATA_BUDGET_MS);
  if (budgetMs !== null) {
    expect(dataRequestsOverBudget(completedDataRequests, budgetMs).map(formatDataRequest)).toEqual([]);
  }
});
