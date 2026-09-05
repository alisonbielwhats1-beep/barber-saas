// Run against a local development server, before building. The temporary route
// renders the actual AgendaBoard with synthetic records and is always removed.
import { chromium } from '@playwright/test';
import { constants, copyFile, mkdir, unlink } from 'node:fs/promises';
import sharp from 'sharp';

const base = process.env.MARKETING_BASE_URL || 'http://127.0.0.1:3001';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Only local capture is allowed.');
const target = 'src/app/design-capture/page.tsx';
await mkdir('src/app/design-capture', { recursive: true });
await copyFile('scripts/fixtures/agenda-capture.tsx', target, constants.COPYFILE_EXCL);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', timeout: 60000 });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light']) {
    await page.goto(`${base}/design-capture?theme=${theme}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.getByRole('group', { name: 'Visualização da agenda' }).waitFor({ timeout: 60000 });
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    const bytes = await page.screenshot({ timeout: 30000, animations: 'disabled' });
    await sharp(bytes).webp({ quality: 95 }).toFile(`public/images/product-agenda-${theme}.webp`);
    console.log(`Captured real AgendaBoard: ${theme}`);
  }
} finally {
  await unlink(target);
  if (browser) await browser.close();
}
