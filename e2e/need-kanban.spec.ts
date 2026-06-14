import { test, expect } from '@playwright/test';

test('needs page renders kanban columns', async ({ page }) => {
  await page.goto('/needs');
  await expect(page.getByRole('heading', { name: /需求看板/ })).toBeVisible();
  await expect(page.getByText('待办')).toBeVisible();
});
