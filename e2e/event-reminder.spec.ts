import { test, expect } from '@playwright/test';

test('event appears in calendar', async ({ page }) => {
  await page.goto('/events/new');
  await page.getByLabel('标题 *').fill('E2E 事件');
  await page.getByLabel('开始 *').fill(new Date(Date.now() + 86400_000).toISOString().slice(0, 16));
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 事件' })).toBeVisible();
});
