import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts/scrollcraft-v2', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('https://aiautomationsociety.ai/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.screenshot({ path: 'artifacts/scrollcraft-v2/reference-start.png', timeout: 45000 });
  console.log(await page.locator('h1').innerText());
  const evidence = await page.evaluate(() => ({
    layers: [...document.querySelectorAll('[class*=hero],[class*=layer],[class*=scene],[class*=cloud]')].slice(0,75).map(el => ({ tag: el.tagName, class: el.className, position: getComputedStyle(el).position, transform: getComputedStyle(el).transform, z: getComputedStyle(el).zIndex, background: getComputedStyle(el).backgroundImage, src: el.getAttribute('src') })),
    scripts: [...document.scripts].map(s => s.src).filter(Boolean),
  }));
  await writeFile('artifacts/scrollcraft-v2/reference-structure.json', JSON.stringify(evidence,null,2));
  for (const y of [600,1300,2200]) {
    await page.evaluate(y => window.scrollTo(0,y), y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `artifacts/scrollcraft-v2/reference-${y}.png`, timeout: 45000 });
  }
  await page.goto('http://127.0.0.1:3001/signup', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.screenshot({ path: 'artifacts/scrollcraft-v2/signup-before.png', fullPage:true, timeout:45000 });
} finally { await browser.close(); }
