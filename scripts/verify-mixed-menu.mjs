import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle' });
  await page.locator('main[data-ready=true]').waitFor();
  await page.getByRole('button', { name: 'Espaço misto', exact: true }).click();
  const color = await page.locator('.mk-menu-toggle svg').evaluate(el => getComputedStyle(el).color);
  assert.equal(color, 'rgb(244, 241, 235)');
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Navegação móvel' }).waitFor();
  const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.equal(audit.violations.length, 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'artifacts/refinement-v3/verified-mixed-menu-320.png' });
  await page.getByRole('navigation', { name: 'Navegação móvel' }).getByRole('link', { name: 'Recursos', exact: true }).click();
  await page.waitForURL('**/#recursos');
  assert.equal(await page.locator('#marketing-menu').getAttribute('hidden'), '');
  await writeFile('artifacts/refinement-v3/menu-verification.json', JSON.stringify({ width: 320, color, violations: audit.violations, navigation: 'passed' }, null, 2));
  console.log('Mixed menu: contrast, navigation, mobile bounds and accessibility passed.');
} finally {
  await browser.close();
}
