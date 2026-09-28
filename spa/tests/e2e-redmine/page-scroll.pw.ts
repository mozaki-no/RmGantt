import { expect, test, type Page } from '@playwright/test';
import { adminLogin } from './helpers';

// The chart has its own scrollbars. If the Redmine page around it can scroll
// too, a wheel turn over the chart edges moves the page and the chart together
// and the view jitters.
const pageOverflow = (page: Page) => page.evaluate(
  () => document.documentElement.scrollHeight - document.documentElement.clientHeight
);

for (const viewport of [{ width: 1400, height: 900 }, { width: 1000, height: 700 }]) {
  test(`keeps the Redmine page from scrolling behind the chart at ${viewport.width}x${viewport.height}`, async ({ page, baseURL }) => {
    const redmineBase = baseURL ?? 'http://127.0.0.1:3000';
    await page.setViewportSize(viewport);

    await adminLogin(redmineBase, page);
    await page.goto(`${redmineBase}/projects/ecookbook/canvas_gantt`);
    await expect(page.locator('[data-testid^="task-row-"]').first()).toBeVisible();

    await expect.poll(() => pageOverflow(page)).toBeLessThanOrEqual(0);

    const sidebarBody = page.getByTestId('sidebar-body');
    const box = await sidebarBody.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 40, box!.y + 40);
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.wheel(0, 200);
    }

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
}
