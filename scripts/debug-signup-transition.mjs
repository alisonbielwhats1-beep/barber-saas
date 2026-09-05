import { chromium } from '@playwright/test';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>console.log('ERROR',e.message));
for(const [id,label]of [['salao','Salão de beleza'],['barbearia','Barbearia'],['espaco-misto','Espaço misto']]){
await page.goto('http://127.0.0.1:3001',{waitUntil:'networkidle'});await page.getByRole('checkbox',{name:'Pausar movimento'}).check();await page.getByRole('button',{name:label,exact:true}).click();console.log('BEFORE',id,await page.locator('.sc-actions a').first().getAttribute('href'),await page.locator('main.mk').getAttribute('data-segment'));
await page.locator('.sc-actions a').first().click();await page.waitForTimeout(1500);console.log('AFTER',page.url());await page.screenshot({path:`artifacts/refinement-v3/debug-${id}.png`});}
}finally{await browser.close();}
