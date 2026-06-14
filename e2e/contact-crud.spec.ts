import { test, expect } from '@playwright/test';

test('contact CRUD', async ({ page }) => {
  // Create
  await page.goto('/contacts');
  await page.getByRole('link', { name: '新建' }).click();
  await page.getByLabel('姓名 *').fill('测试联系人');
  await page.getByLabel('城市').fill('上海');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('heading', { name: '测试联系人' })).toBeVisible();

  // List
  await page.goto('/contacts');
  await expect(page.getByText('测试联系人')).toBeVisible();
});
