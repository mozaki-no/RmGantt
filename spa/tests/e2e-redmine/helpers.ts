import { type Page } from '@playwright/test';

// The Compose environment and CI both use admin/admin. A load-test host runs
// against its own long-lived administrator, so allow that without editing this
// file - patching a committed test to run it is how a run stops being
// reproducible.
const login = process.env.CANVAS_GANTT_SMOKE_LOGIN?.trim() || 'admin';
const password = process.env.CANVAS_GANTT_SMOKE_PASSWORD?.trim() || 'admin';

export const adminLogin = async (baseURL: string, page: Page) => {
  await page.goto(`${baseURL}/login`);
  await page.locator('#username').fill(login);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();

  const passwordChangeField = page.locator('#new_password');
  if (await passwordChangeField.isVisible().catch(() => false)) {
    await passwordChangeField.fill(password);
    await page.locator('#new_password_confirmation').fill(password);
    await page.getByRole('button', { name: /apply|save/i }).click();
  }
};
