import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:3001',{waitUntil:'networkidle',timeout:90000});await page.getByRole('checkbox',{name:'Pausar movimento'}).check();await page.getByRole('button',{name:'Espaço misto',exact:true}).click();await page.waitForTimeout(1500);
  await page.screenshot({path:'artifacts/refinement-v3/mixed-hero.png'});
  for(const y of [650,1050,1450]){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(300);await page.screenshot({path:`artifacts/refinement-v3/handoff-${y}.png`});}
  for(const [selector,name] of [['.cp-finance','finance'],['.cp-client','client'],['.cp-marketing','marketing'],['.pc-section','prices']]){await page.locator(selector).screenshot({path:`artifacts/refinement-v3/${name}.png`});}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:'artifacts/refinement-v3/mixed-mobile.png'});
  await page.locator('.cp-client').screenshot({path:'artifacts/refinement-v3/client-mobile.png'});await page.locator('.pc-section').screenshot({path:'artifacts/refinement-v3/prices-mobile.png'});
}finally{await browser.close();}
