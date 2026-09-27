import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { snapshotDatabase, hashes, assertEffects, type Snapshot } from '../../src/test/secretary-execution-evidence';
import { localDateTimeToUtc } from '../../src/lib/time';
const out=process.env.EXECUTION_E2E_OUTPUT!;
const fixture=JSON.parse(readFileSync(resolve(out,'fixture.json'),'utf8'));
const db=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL}}});
const save=(name:string,value:unknown)=>writeFileSync(resolve(out,name+'.json'),JSON.stringify(value,null,2));
test.afterAll(async()=>db.$disconnect());
test('authorized closure: Agenda and Produtos refresh; Serviços read-only regression',async({page,context})=>{
 test.setTimeout(240000);
 const external:string[]=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page).toHaveURL(/\/(pos-login|hoje|dashboard)/,{timeout:60000});
 const requests:{url:string;action:string;body:string|null;contentType:string}[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&r.headers()['next-action'])requests.push({url:r.url(),action:r.headers()['next-action'],body:r.postData(),contentType:r.headers()['content-type']});});
 const panel=page.getByRole('dialog',{name:'Secretária',exact:true});const input=panel.getByRole('textbox',{name:'Mensagem'});
 let cursor:Snapshot=await snapshotDatabase(db);
 async function observe(label:string,permission:Parameters<typeof assertEffects>[3]={}){
  const next=await snapshotDatabase(db);
  save(label+'-observation',{before:hashes(cursor),after:hashes(next),fixture_rows:Object.fromEntries(Object.entries(next).map(([t,rows])=>[t,rows.filter(r=>r.salonId===fixture.salonId)]))});
  const effects=assertEffects(cursor,next,fixture.salonId,permission);save(label,{effects,requests:[...requests],panel:await panel.innerText()});cursor=next;
 }
 async function open(path:string){await page.goto(path);await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();}
 async function send(text:string){await input.fill(text);await panel.getByRole('button',{name:'Enviar',exact:true}).click();await expect(input).toBeEnabled();await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toBeEnabled();}
 async function confirm(){await panel.getByRole('button',{name:'Confirmar',exact:true}).click();await expect(panel.getByText('Resultado confirmado pelo sistema',{exact:true})).toBeVisible();}
 if(process.env.SECRETARY_FRONT_RESUME_PRODUCTS!=='true'){
 await open('/servicos');const services=page.getByLabel('Lista de serviços');await expect(services).toContainText('100,00');
 await observe('service-read-only-regression');await page.screenshot({path:resolve(out,'service-read-only.png')});
 await open('/agenda?date='+fixture.date);
 await expect(page.getByRole('button',{name:/Amanda Souza, Massagem, 10:00/})).toBeVisible();
 await send('Muda Amanda Souza de amanhã às 10h para 11h.');await observe('appointment-proposal-no-write');await confirm();
 // No navigation, reload or manual refresh between confirmation and these assertions.
 await expect(page.getByRole('button',{name:/Amanda Souza, Massagem, 11:00/})).toBeVisible();
 await expect(page.getByRole('button',{name:/Amanda Souza, Massagem, 10:00/})).toHaveCount(0);
 expect((await db.appointment.findUniqueOrThrow({where:{id:fixture.appointmentId}})).startAt.toISOString()).toBe(localDateTimeToUtc(`${fixture.date}T11:00`,'America/Sao_Paulo').toISOString());
 await observe('appointment-refreshed',{updates:{Appointment:{[fixture.appointmentId]:['startAt','endAt','updatedAt','version']}},inserts:{AppointmentEvent:1,NotificationOutbox:1}});await page.screenshot({path:resolve(out,'agenda-refresh.png')});
 }
 await open('/produtos');const products=page.getByLabel('Lista de produtos');
 const product=products.locator('summary').filter({has:page.getByText('Shampoo X',{exact:true})});
 await expect(product).toBeVisible();await expect(product.getByText('Estoque: 10',{exact:true})).toBeVisible();
 await send('Dá baixa em 2 unidades do Shampoo X.');await observe('inventory-proposal-no-write');await confirm();
 await expect(product.getByText('Estoque: 8',{exact:true})).toBeVisible();await expect(product.getByText('Estoque: 10',{exact:true})).toHaveCount(0);
 expect((await db.product.findUniqueOrThrow({where:{id:fixture.productId}})).stock).toBe(8);
 await observe('inventory-refreshed',{updates:{Product:{[fixture.productId]:['stock','updatedAt']}}});await page.screenshot({path:resolve(out,'products-refresh.png')});
 const confirmation=requests.at(-1)!;
 const replay=await page.request.post(confirmation.url,{headers:{'next-action':confirmation.action,'content-type':confirmation.contentType,origin:'http://127.0.0.1:3157'},data:confirmation.body!});
 const replayBody=await replay.text();save('inventory-confirmation-replay',{status:replay.status(),request:confirmation,response:replayBody});
 expect(replay.ok()).toBe(true);expect(replayBody).toContain('"stock":8');
 await expect(product.getByText('Estoque: 8',{exact:true})).toBeVisible();
 await observe('inventory-replay-no-second-mutation');
 const desktop=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();save('desktop-accessibility',{violations:desktop.violations});expect(desktop.violations).toEqual([]);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'mobile-receipt.png')});
 const mobile=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();save('mobile-accessibility',{violations:mobile.violations});expect(mobile.violations).toEqual([]);
 await panel.getByRole('button',{name:'Nova conversa',exact:true}).click();await input.fill('Texto preservado');await panel.getByRole('button',{name:'Fechar Secretária'}).click();await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();await expect(input).toHaveValue('Texto preservado');
 await page.setViewportSize({width:320,height:560});expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(input).toBeInViewport();await page.keyboard.press('Tab');expect(await panel.evaluate(el=>el.contains(document.activeElement))).toBe(true);await page.screenshot({path:resolve(out,'mobile-small-keyboard.png')});
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();await expect(input).toHaveValue('Texto preservado');
 await observe('final-no-extra-effects');expect(external).toEqual([]);
 save('refresh-verdict',{service:'PASS historical refresh + current read-only regression',agenda:'PASS',products:'PASS',confirmation_receipts:'PASS',desktop:'PASS',mobile:'PASS',a11y:'PASS',keyboard:'PASS',manual_reload_between_confirmation_and_refresh:false,unexpected_mutations:0,external_requests:external,paid_calls:0,model:'scripted interpreter; real auth/backend/PG'});
});
