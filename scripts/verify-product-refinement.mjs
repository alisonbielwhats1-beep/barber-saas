import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const out='artifacts/audit-2026-09-06';
await mkdir(out,{recursive:true});
if (!process.env.CODESPACES) throw new Error('Execute apenas na demonstração isolada do Codespaces.');
const credentials=JSON.parse(await readFile('.demo/credentials.json','utf8'));
const access={...credentials,url:'http://localhost:3000'};
const report={checks:[],pages:[],errors:[]};
const browser=await chromium.launch({headless:true});
const nonce=()=>`review=${Date.now()}`;
async function visit(page,path){await page.goto(`${access.url}${path}${path.includes('?')?'&':'?'}${nonce()}`,{waitUntil:'networkidle'});}
async function capture(page,name){
 await page.screenshot({path:`${out}/refined-${name}.png`,fullPage:false});
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 report.pages.push({name,path:new URL(page.url()).pathname,violations:audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
 await writeFile(`${out}/refined-${name}-dom.txt`,await page.locator('body').ariaSnapshot());
}
async function login(role,width=1440,returnTo=''){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push({role,error:e.message}));
 const path=role==='client'?'/book/everflair-demo/login':'/login';
 await visit(page,path+(returnTo?'?returnTo='+encodeURIComponent(returnTo):''));
 const notice=page.getByRole('button',{name:'Continue',exact:true});if(await notice.count()){await notice.click();await page.waitForLoadState('networkidle');}
 await page.waitForTimeout(1800);
 await page.locator('input[type=email]').fill(access[role].email);
 await page.locator('input[type=password]').fill(access[role].password);
 const posted=page.waitForResponse(r=>r.request().method()==='POST'&&(role==='client'?new URL(r.url()).pathname===path:r.url().includes('/api/auth/callback/credentials')));
 await page.getByRole('button',{name:'Entrar',exact:true}).click();const result=await posted;
 if(result.status()>=400)throw new Error(`${role} login failed ${result.status()}`);
 await page.waitForTimeout(1500);return {context,page};
}
try {
 const {context,page}=await login('owner');
 await visit(page,'/dashboard');await expect(page.getByText('Alex Costa · Demonstração',{exact:true})).toBeVisible();
 const primary=await page.locator('.admin-shell').evaluate(el=>getComputedStyle(el).getPropertyValue('--primary').trim());
 expect(primary).toBe('40 33% 95%');report.checks.push('Owner verified; neutral theme overrides removed');
 await capture(page,'dashboard-dark-desktop');
 await page.getByRole('button',{name:'Mudar para tema claro'}).click();await page.waitForTimeout(900);await capture(page,'dashboard-light-desktop');
 await page.setViewportSize({width:390,height:844});await visit(page,'/dashboard');await capture(page,'dashboard-light-mobile');
 await page.getByRole('button',{name:'Abrir todos os módulos'}).click();
 await expect(page.getByRole('dialog').getByRole('button',{name:'Sair da conta'})).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('button',{name:'Everflair Studio · Demonstração'})).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'Mudar para tema escuro'}).click();await capture(page,'mobile-menu');
 report.checks.push('Mobile: establishment switcher, theme and sign out accessible');
 await page.keyboard.press('Escape');await visit(page,'/dashboard');await capture(page,'dashboard-dark-mobile');
 await visit(page,'/agenda');const filters=page.getByRole('button',{name:/^Filtros/});await expect(filters).toHaveAttribute('aria-expanded','false');
 await filters.click();await expect(filters).toHaveAttribute('aria-expanded','true');await filters.click();await capture(page,'agenda-mobile');
 report.checks.push('Agenda mobile filters collapse and expand');
 await page.setViewportSize({width:1440,height:900});await visit(page,'/agenda');await capture(page,'agenda-desktop');
 await visit(page,'/financeiro');await expect(page.getByText('Concluídos sem pagamento registrado',{exact:true})).toBeVisible();await capture(page,'finance-desktop');
 await context.close();
 const receptionist=await login('reception');await visit(receptionist.page,'/dashboard');
 await expect(receptionist.page.getByText('Dani Lima · Recepção Demo',{exact:true})).toBeVisible();
 expect(new URL(receptionist.page.url()).pathname).toBe('/hoje');await expect(receptionist.page.locator('a[href="/dashboard"]')).toHaveCount(0);
 await visit(receptionist.page,'/financeiro');expect(new URL(receptionist.page.url()).pathname).toBe('/hoje');
 report.checks.push('Reception identity verified: dashboard and finance redirect to Hoje');await capture(receptionist.page,'reception-hoje');await receptionist.context.close();
 const customer=await login('client',390,'/book/everflair-demo/agendar');
 await expect(customer.page).toHaveURL(/\/agendar/);report.checks.push('Client login resumes booking');
 await visit(customer.page,'/book/everflair-demo');await capture(customer.page,'client-home-mobile');
 const content=await customer.page.locator('body').ariaSnapshot();expect(content.indexOf('Agendar um horário')).toBeLessThan(content.indexOf('Avaliações'));
 report.checks.push('Client booking CTA precedes reviews');await customer.context.close();
}catch(error){report.errors.push({error:String(error)});console.error(String(error));process.exitCode=1;}
finally{await writeFile(`${out}/refinement-browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,pages:report.pages.map(p=>({name:p.name,violations:p.violations.map(v=>v.id)})),errors:report.errors}));await browser.close();}

