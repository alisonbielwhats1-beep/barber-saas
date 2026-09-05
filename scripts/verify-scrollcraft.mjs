import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output='artifacts/refinement-v3';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={checks:[],axe:[],errors:[]};
const check=(label,condition)=>{assert.ok(condition,label);report.checks.push(label);};
async function audit(page,label){const result=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();report.axe.push({label,violations:result.violations});check(`Accessibility: ${label}`,result.violations.length===0);}
async function settle(page){await page.waitForTimeout(1400);}
try{
  for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[360,740],[320,640]]){
    const context=await browser.newContext({viewport:{width,height}});
    const page=await context.newPage(); page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto('http://127.0.0.1:3001',{waitUntil:'networkidle',timeout:120000});
    await page.locator('.sc-hero[data-motion=full]').waitFor(); await page.locator('main[data-ready=true]').waitFor(); await page.getByRole('checkbox',{name:'Pausar movimento'}).check();
    for(const name of ['Salão de beleza','Barbearia','Manicure','Estética','Massagem e bem-estar','Espaço misto']){
      await page.getByRole('button',{name,exact:true}).click();await settle(page);
      check(`Selected ${name} at ${width}`,await page.getByRole('button',{name,exact:true}).getAttribute('aria-pressed')==='true');
      check(`No horizontal overflow ${name} at ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      check(`Atmosphere ${name} at ${width}`,await page.locator('main.mk').getAttribute('data-atmosphere')===(name==='Barbearia'?'dark':'light'));
      if((width===1440||width===390)&&(name==='Barbearia'||name==='Salão de beleza'||name==='Espaço misto')){
        await audit(page,`${width}-${name}`);
        await page.screenshot({path:`${output}/verified-${width}-${name==='Barbearia'?'dark':name==='Espaço misto'?'mixed':'light'}.png`});
      }
    }
    const targets=await page.locator('.sc-segment-controls button,.sc-playback').evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return{w:r.width,h:r.height,right:r.right,left:r.left};}));
    check(`Segment targets accessible at ${width}`,targets.every(r=>r.w>=44&&r.h>=44&&r.left>=0&&r.right<=width));
    const before=await page.locator('[data-depth]').evaluateAll(items=>items.map(item=>getComputedStyle(item).transform));
    await page.evaluate(()=>scrollTo(0,400));await page.waitForTimeout(200);
    const after=await page.locator('[data-depth]').evaluateAll(items=>items.map(item=>getComputedStyle(item).transform));
    check(`Independent depth responds at ${width}`,after.filter((value,index)=>value!==before[index]).length>=3);
    for(const id of ['sistema','recursos','planos']){await page.locator(`#${id}`).scrollIntoViewIfNeeded();await page.waitForTimeout(200);check(`Section ${id} fits ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    if(width===1440||width===390){
      for(const route of ['login','signup']){
        await page.goto(`http://127.0.0.1:3001/${route}`,{waitUntil:'networkidle',timeout:90000});
        check(`${route} fits ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await audit(page,`${route}-${width}`);await page.screenshot({path:`${output}/verified-${route}-${width}.png`,fullPage:true});
      }
      await page.locator('#salonName').fill('Estabelecimento de teste');await page.locator('#ownerName').fill('Pessoa de teste');await page.locator('#email').fill('design@example.com');await page.locator('#password').fill('password123');await page.locator('#confirmPassword').fill('different123');
      let mutations=0;page.on('request',request=>{if(request.method()==='POST')mutations++;});
      await page.getByRole('button',{name:'Criar meu espaço',exact:true}).click();
      check(`Password mismatch remains local ${width}`,await page.locator('form [role=alert]').innerText()==='As senhas não coincidem.'&&mutations===0);
    }
    await context.close();
  }
  const autoContext=await browser.newContext({viewport:{width:1440,height:1000}});const auto=await autoContext.newPage();
  await auto.goto('http://127.0.0.1:3001',{waitUntil:'networkidle',timeout:90000});
  await auto.mouse.move(0,0);
  const initial=await auto.locator('main.mk').getAttribute('data-segment');
  await auto.waitForFunction(initial=>document.querySelector('main.mk').dataset.segment!==initial,initial,{timeout:12000});
  check('Automatic segment advance in a real browser',true);
  const video=await auto.locator('video').evaluate(v=>({ready:v.readyState,time:v.currentTime,paused:v.paused,muted:v.muted,duration:v.duration}));
  check('Local ambient video actually plays',video.ready>=2&&video.time>0&&!video.paused&&video.muted&&video.duration>7);
  await auto.getByRole('checkbox',{name:'Pausar movimento'}).check();
  check('Pause stops video',await auto.locator('video').evaluate(v=>v.paused));
  await autoContext.close();
  const reducedContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const reduced=await reducedContext.newPage();let videoRequests=0;
  reduced.on('request',r=>{if(r.url().includes('atelier-motion'))videoRequests++;});
  await reduced.goto('http://127.0.0.1:3001',{waitUntil:'networkidle',timeout:90000});
  check('Reduced motion starts paused',await reduced.getByRole('checkbox',{name:'Pausar movimento'}).isChecked());
  check('Reduced motion does not load video',videoRequests===0);
  check('Reduced motion removes pin',await reduced.locator('.sc-stage').evaluate(el=>getComputedStyle(el).position)!=='sticky');
  await reduced.getByRole('button',{name:'Barbearia',exact:true}).click();check('Manual dark mode works with reduced motion',await reduced.locator('main.mk').getAttribute('data-atmosphere')==='dark');
  await audit(reduced,'reduced-mobile');await reduced.screenshot({path:`${output}/verified-reduced.png`,fullPage:true});
  await reducedContext.close();
    const flowContext=await browser.newContext({viewport:{width:390,height:844}});const flow=await flowContext.newPage();
  for(const [id,label,formLabel] of [['salao','Salão de beleza','Salão'],['barbearia','Barbearia','Barbearia'],['manicure','Manicure','Manicure'],['estetica','Estética','Estética'],['bem-estar','Massagem e bem-estar','Estética'],['espaco-misto','Espaço misto','Misto']]){
    await flow.goto('http://127.0.0.1:3001',{waitUntil:'networkidle'});
    await flow.locator('.sc-hero[data-motion=full]').waitFor(); await flow.locator('main[data-ready=true]').waitFor(); await flow.getByRole('checkbox',{name:'Pausar movimento'}).check();
    await flow.getByRole('button',{name:label,exact:true}).click();
    await flow.locator('.sc-actions a').first().click();
    await flow.waitForURL(`**/signup?segment=${id}`);
    await flow.locator('main[data-ready=true]').waitFor();
    check(`Signup keeps ${id} atmosphere`,await flow.locator('main.mk').getAttribute('data-segment')===id);
    check(`Signup preselects ${id}`,await flow.getByRole('button',{name:formLabel,exact:true}).getAttribute('aria-pressed')==='true');
    if(id==='espaco-misto'||id==='barbearia'){await settle(flow);await audit(flow,`signup-${id}`);await flow.screenshot({path:`${output}/signup-${id}.png`,fullPage:true});}
  }
  await flow.goto('http://127.0.0.1:3001',{waitUntil:'networkidle'});await flow.locator('.sc-hero[data-motion=full]').waitFor(); await flow.locator('main[data-ready=true]').waitFor(); await flow.getByRole('checkbox',{name:'Pausar movimento'}).check();
  check('No Play button',await flow.locator('.sc-playback').count()===0);
  for(const [label,index] of [['Início',0],['Agendar',1],['Reservas',2],['Avisos',3]]){await flow.getByRole('group',{name:'Explorar telas do aplicativo'}).getByRole('button',{name:label,exact:true}).click();check(`Client app screen ${label}`,await flow.locator('.cp-screen-controls button').nth(index).getAttribute('aria-pressed')==='true');}
  await flow.locator('#planos').scrollIntoViewIfNeeded();
  check('Price comparison available',await flow.getByRole('table').count()===1);
  check('Four current plan prices',await flow.locator('.pc-price').allTextContents().then(values=>values.join(' ').includes('R$ 0')&&values.join(' ').includes('R$ 49,90')&&values.join(' ').includes('R$ 79,90')&&values.join(' ').includes('R$ 179,90')));
  await flowContext.close();
  check('No browser runtime errors',report.errors.length===0);
}finally{await writeFile(`${output}/verification.json`,JSON.stringify(report,null,2));await browser.close();console.log(`${report.checks.length} checks; ${report.axe.length} accessibility audits; ${report.errors.length} runtime errors.`);}
