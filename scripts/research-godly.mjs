import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('https://godly.design/hero/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(2000);
  await page.screenshot({path:'artifacts/scrollcraft-v2/godly-hero.png'});
  await page.goto('https://vessa.design/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(2000);
  await page.screenshot({path:'artifacts/scrollcraft-v2/reference-vessa.png'});
}finally{await browser.close();}
