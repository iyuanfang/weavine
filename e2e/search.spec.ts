import { test, expect } from '@playwright/test';

test('search page loads with search bar', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByPlaceholder('搜索')).toBeVisible();
});
