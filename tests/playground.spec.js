import { test, expect } from '@playwright/test';
test('techniques animate, hit targets, pause, reset, and respond to keyboard and pointer', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#technique-title')).toContainText('Blue');
  await page.screenshot({ path: 'docs/screenshots/playground.png', fullPage: true });
  await page.getByRole('button', { name: /Release technique/ }).click();
  await expect(page.locator('#hit-count')).toHaveText('1');
  await page.keyboard.press('2');
  await expect(page.locator('#technique-title')).toContainText('Red');
  await expect(page.locator('#cast')).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.locator('#hit-count')).toHaveText('2');
  await expect(page.locator('#cast')).toBeEnabled();
  await page.keyboard.press('3');
  await page.keyboard.press('Space');
  await expect(page.locator('#cast-announcement')).toContainText('HOLLOW PURPLE');
  await page.waitForTimeout(650);
  await page.screenshot({ path: 'docs/screenshots/purple.png', fullPage: true });
  await expect(page.locator('#hit-count')).toHaveText('3');
  await page.keyboard.press('p');
  await expect(page.locator('#paused-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Resume simulation' }).click();
  await expect(page.locator('#cast')).toBeEnabled();
  await page.keyboard.press('4');
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await expect(page.locator('#hit-count')).toHaveText('4');
  await page.screenshot({ path: 'docs/screenshots/domain.png', fullPage: true });
  await page.keyboard.press('r');
  await expect(page.locator('#hit-count')).toHaveText('0');
  await expect(page.locator('#cast-count')).toHaveText('0');
  await page.keyboard.press('1');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width * 0.83, box.y + box.height * 0.49);
  await expect(page.locator('#hit-count')).toHaveText('1');
  expect(errors).toEqual([]);
});
test('local model runs in a real worker with a fake camera, then stops every camera track', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: /Enable hand tracking/ }).click();
  await expect(page.locator('#tracking-status')).toContainText('Active', { timeout: 45000 });
  await expect(page.locator('#fps')).toHaveAttribute('title', /Hand inference: [1-9]\d*ms/, {
    timeout: 10000,
  });
  expect(
    await page
      .locator('#camera')
      .evaluate((v) => v.srcObject.getVideoTracks().every((t) => t.readyState === 'live')),
  ).toBe(true);
  await page.getByRole('button', { name: /Disable hand tracking/ }).click();
  await expect(page.locator('#tracking-status')).toContainText('Standby');
  expect(await page.locator('#camera').evaluate((v) => v.srcObject)).toBe(null);
  expect(errors).toEqual([]);
});
test('camera denial preserves keyboard fallback and offers retry', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Enable hand tracking/ }).click();
  await expect(page.locator('#camera-message')).toContainText('permission was denied');
  await expect(page.getByRole('button', { name: /Enable hand tracking/ })).toBeEnabled();
  await page.keyboard.press('3');
  await expect(page.locator('#technique-title')).toContainText('Hollow Purple');
});
test('mobile layout, guide, quality and reduced motion settings work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: /How to play/ }).click();
  await expect(page.locator('#guide-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close guide' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Visual quality', { exact: false }).selectOption('low');
  await page.getByLabel('Reduced motion', { exact: false }).check();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByLabel('Reduced motion', { exact: false })).toBeChecked();
  await expect(page.getByLabel('Visual quality', { exact: false })).toHaveValue('low');
});
