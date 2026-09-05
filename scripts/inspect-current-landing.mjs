import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('artifacts/refinement-v3',{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('https://salon-saas-ruby.vercel.app/',{waitUntil:'networkidle',timeout:90000});await page.screenshot({path:'artifacts/refinement-v3/current-site.png',fullPage:true});await writeFile('artifacts/refinement-v3/current-site.json',JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,images:[...document.images].map(i=>({src:i.currentSrc,alt:i.alt})),videos:[...document.querySelectorAll('video')].map(v=>v.currentSrc)})),null,2));}finally{await browser.close();}
