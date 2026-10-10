import {test,expect} from '@playwright/test';
import { openSecretary } from './open-secretary';
import {PrismaClient} from '@prisma/client';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {snapshotDatabase,hashes,assertEffects} from '../../src/test/secretary-execution-evidence';
const out=process.env.EXECUTION_E2E_OUTPUT!,fixture=JSON.parse(readFileSync(resolve(out,'fixture.json'),'utf8'));
const db=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
test.afterAll(async()=>db.$disconnect());
test('read-only finish: persisted domain state, desktop/mobile shell and accessibility',async({page,context})=>{
 test.setTimeout(120000);const before=await snapshotDatabase(db),external:string[]=[];
 await context.route('**/*',route=>{if(!['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/\/(pos-login|hoje|dashboard)/,{timeout:60000});
 await page.goto('/agenda?date='+fixture.date);await expect(page.getByRole('button',{name:/Amanda Souza, Massagem, 11:00/})).toBeVisible();
 await page.goto('/servicos');await expect(page.getByLabel('Lista de serviços')).toContainText('100,00');
 await page.goto('/produtos');await expect(page.getByLabel('Lista de produtos').locator('summary').filter({has:page.getByText('Shampoo X',{exact:true})}).getByText('Estoque: 8',{exact:true})).toBeVisible();
 await openSecretary(page);const panel=page.getByRole('dialog',{name:'Secretária',exact:true}),input=panel.getByRole('textbox',{name:'Mensagem'});
 await input.fill('Texto preservado');await panel.getByRole('button',{name:'Fechar Secretária'}).click();await openSecretary(page);await expect(input).toHaveValue('Texto preservado');
 const a11y:Record<string,unknown>={};
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:560}]){
  await page.setViewportSize(viewport);await expect(input).toBeInViewport();expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();a11y[String(viewport.width)]=axe.violations;expect(axe.violations).toEqual([]);
  await page.screenshot({path:resolve(out,`shell-${viewport.width}.png`)});
 }
 await input.focus();await page.keyboard.press('Tab');expect(await panel.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await openSecretary(page);await expect(input).toHaveValue('Texto preservado');
 const after=await snapshotDatabase(db),effects=assertEffects(before,after,fixture.salonId);expect(effects).toEqual([]);expect(external).toEqual([]);
 writeFileSync(resolve(out,'shell-verdict.json'),JSON.stringify({result:'PASS',before:hashes(before),after:hashes(after),effects,external,a11y,domain_readback:{appointment:'11:00',stock:8,service:10000},viewports:[1440,390,320],keyboard:'PASS',physical_keyboard:'NOT_TESTED'},null,2));
});
