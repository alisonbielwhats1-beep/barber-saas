import { expect, type Page } from '@playwright/test';

/** Prototype v6 (owner, 08/10/2026): there is no floating "Abrir Secretária" button any more. The menu item (computer) and the
 * tab in the middle of the bottom bar (phone) open the panel by dispatching this event. The panel is loaded lazily after the
 * page, so the event is repeated until the panel shows. */
export async function openSecretary(page: Page) {
  const panel = page.getByRole('dialog', { name: 'Secretária', exact: true });
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('everflair:secretary-open')));
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60000 });
  return panel;
}

/** Closed, nothing of the panel may keep intercepting the product: a click on the content must reach it (trial click: the
 * hit target is checked, nothing is clicked). */
export async function expectContentReachable(page: Page) {
  await page.locator('#main-content').click({ trial: true, timeout: 5000 });
}
