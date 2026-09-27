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
test('real local frontend → authenticated confirmation → PostgreSQL → receipts → refetch',async({page,context})=>{
 test.setTimeout(300000);
 const blockedScreens: {screen:string;reason:string}[]=[];
 async function checkScreen(path:string, label:RegExp, name:string){const tab=await context.newPage();try{await tab.goto(path);await expect(tab.getByRole('button',{name:label}).first()).toBeVisible({timeout:5000});}catch{blockedScreens.push({screen:name,reason:'Existing disposable runtime grants deny a manual Front query; no grants changed.'});}finally{await tab.screenshot({path:resolve(out,name+'-screen.png')});await tab.close();}}
 const external:string[]=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.origin);return route.abort();}return route.continue();});
 await page.goto('/login');
 await page.getByLabel('Email',{exact:true}).fill(fixture.email);
 await page.getByLabel('Senha',{exact:true}).fill(fixture.password);
 await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page).toHaveURL(/\/(pos-login|hoje|dashboard)/, {timeout:60000});
 await page.goto('/servicos');
 await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Secretária',exact:true});
 const input=panel.getByRole('textbox',{name:/Mensagem/});
 await expect(panel).toBeVisible();
 await input.fill('Texto preservado ao fechar');
 await panel.getByRole('button',{name:'Fechar Secretária'}).click();
 await expect(panel).toBeHidden();
 await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 await expect(input).toHaveValue('Texto preservado ao fechar');
 await page.setViewportSize({width:390,height:844});
 await panel.getByRole('button',{name:'Fechar Secretária'}).click();
 // Catch hidden modal intercepting the product after closing.
 await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click({timeout:5000});
 await expect(input).toHaveValue('Texto preservado ao fechar');
 await page.screenshot({path:resolve(out,'mobile-shell.png')});
 await page.keyboard.press('Escape');
 await expect(panel).toBeHidden();
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 await input.fill('');
 const voiceCapabilities=await page.evaluate(()=>({recognition:'SpeechRecognition' in window||'webkitSpeechRecognition' in window,synthesis:'speechSynthesis' in window,voices:window.speechSynthesis?.getVoices().map(v=>({lang:v.lang,local:v.localService}))}));
 save('native-voice-capabilities',voiceCapabilities);
 let cursor:Snapshot=await snapshotDatabase(db);
 let step=0;
 async function observe(label:string,permission:Parameters<typeof assertEffects>[3]={}){
  const next=await snapshotDatabase(db);save(label+'-observation',{before:hashes(cursor),after:hashes(next),rows:Object.fromEntries(Object.entries(next).map(([t,rows])=>[t,rows.filter(r=>r.salonId===fixture.salonId)]))});const effects=assertEffects(cursor,next,fixture.salonId,permission);
  save(`${++step}-${label}`,{before:hashes(cursor),after:hashes(next),effects,fixture_rows:Object.fromEntries(Object.entries(next).map(([table,rows])=>[table,rows.filter(r=>r.salonId===fixture.salonId)]))});cursor=next;
 }
 const send=async(text:string)=>{await input.fill(text);await panel.getByRole('button',{name:'Enviar',exact:true}).click();await expect(input).toBeEnabled();};
 const confirm=async()=>{await panel.getByRole('button',{name:'Confirmar',exact:true}).click();await expect(panel.getByText('Resultado confirmado pelo sistema',{exact:true})).toBeVisible();};
 const newConversation=async()=>{await panel.getByRole('button',{name:'Nova conversa',exact:true}).click();await expect(input).toBeEnabled();};
 const serviceRows=page.getByLabel('Lista de serviços');
 await send('Altera a Massagem para R$80.');
 await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toBeEnabled();
 await observe('service-proposal-no-business-write');
 await expect(serviceRows).toContainText('100,00');
 await page.screenshot({path:resolve(out,'desktop-proposal.png')});
 const axe=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();save('desktop-accessibility',{violations:axe.violations});expect(axe.violations).toEqual([]);
 await confirm();
 expect((await db.service.findUniqueOrThrow({where:{id:fixture.serviceId}})).priceCents).toBe(8000);
 await expect(serviceRows).toContainText('80,00');await expect(serviceRows).not.toContainText('100,00');
 await observe('service-success',{updates:{Service:{[fixture.serviceId]:['priceCents','updatedAt']}}});
 await page.screenshot({path:resolve(out,'desktop-service-receipt.png')});
 await page.goto('/servicos');await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 await send('Muda Amanda Souza de amanhã às 10h para 11h.');
 await expect(panel.getByRole('article',{name:/Mudar horário/})).toBeVisible();await observe('appointment-proposal');await confirm();
 const appt=await db.appointment.findUniqueOrThrow({where:{id:fixture.appointmentId}});expect(appt.startAt.toISOString()).toBe(localDateTimeToUtc(`${fixture.date}T11:00`,'America/Sao_Paulo').toISOString());
 await checkScreen('/agenda?date='+fixture.date,/Amanda Souza, Massagem, 11:00/,'agenda');
 await observe('appointment-success',{updates:{Appointment:{[fixture.appointmentId]:['startAt','endAt','updatedAt','version']}},inserts:{AppointmentEvent:1,NotificationOutbox:1}});
 await page.screenshot({path:resolve(out,'desktop-agenda-receipt.png')});
 await page.goto('/servicos');await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 await send('Dá baixa em 2 unidades do Shampoo X.');await expect(panel.getByRole('article',{name:/Movimentar estoque/})).toBeVisible();await observe('inventory-proposal');await confirm();
 expect((await db.product.findUniqueOrThrow({where:{id:fixture.productId}})).stock).toBe(8);
 const productsTab=await context.newPage();try{await productsTab.goto('/produtos');await expect(productsTab.getByLabel('Lista de produtos')).toContainText('8',{timeout:5000});}catch{blockedScreens.push({screen:'produtos',reason:'SQLSTATE 42501: Product SELECT columns'});}finally{await productsTab.screenshot({path:resolve(out,'produtos-screen.png')});await productsTab.close();}
 await observe('inventory-success',{updates:{Product:{[fixture.productId]:['stock','updatedAt']}}});
 await page.screenshot({path:resolve(out,'desktop-inventory-receipt.png')});
 await newConversation();await send('Altera a Massagem para R$85 e dá baixa em 2 unidades do Shampoo X.');
 await expect(panel.getByRole('article')).toHaveCount(2);await observe('multi-proposal');await confirm();
 await expect(panel.getByText('Concluído',{exact:true})).toHaveCount(2);
 expect((await db.service.findUniqueOrThrow({where:{id:fixture.serviceId}})).priceCents).toBe(8500);
 expect((await db.product.findUniqueOrThrow({where:{id:fixture.productId}})).stock).toBe(6);
 await observe('multi-success',{updates:{Service:{[fixture.serviceId]:['priceCents','updatedAt']},Product:{[fixture.productId]:['stock','updatedAt']}}});
 await page.screenshot({path:resolve(out,'desktop-multi-receipts.png')});
 await newConversation();await send('Altera a Massagem para R$80.');await observe('stale-initial-proposal');
 await input.fill('Na verdade R$90.');await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toBeDisabled();
 await observe('stale-edited-no-write');await panel.getByRole('button',{name:'Enviar',exact:true}).click();
 await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toBeEnabled();
 await expect(panel.getByRole('article')).toContainText('90,00');await observe('stale-new-proposal');await confirm();
 expect((await db.service.findUniqueOrThrow({where:{id:fixture.serviceId}})).priceCents).toBe(9000);
 await observe('stale-new-confirmation-success',{updates:{Service:{[fixture.serviceId]:['priceCents','updatedAt']}}});
 await db.salonClosure.create({data:{salonId:fixture.salonId,startAt:localDateTimeToUtc(`${fixture.date}T09:00`,'America/Sao_Paulo'),endAt:localDateTimeToUtc(`${fixture.date}T18:00`,'America/Sao_Paulo'),reason:'Fechamento sintético'}});
 await observe('controlled-closure',{inserts:{SalonClosure:1}});
 await newConversation();await send('Cancele Amanda Souza amanhã às 11h a pedido da cliente e coloque Fábio Santos com Corte Completo no lugar. Pode encaixar. Motivo: Cliente já está aguardando.');
 await expect(panel.getByText('Este horário não pode ser usado').first()).toBeVisible();
 await expect(panel.getByRole('button',{name:/Confirmar/})).toBeDisabled();
 await expect(panel.getByRole('button',{name:/override|encaixar|ignorar/i})).toHaveCount(0);
 await observe('hard-block-no-operational-write');
 await page.screenshot({path:resolve(out,'desktop-hard-block.png')});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:resolve(out,'mobile-hard-block.png')});
 const mobileAxe=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();save('mobile-accessibility',{violations:mobileAxe.violations});expect(mobileAxe.violations).toEqual([]);
 await page.setViewportSize({width:320,height:560});
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(input).toBeInViewport();await page.screenshot({path:resolve(out,'mobile-small-keyboard.png')});
 await page.keyboard.press('Tab');expect(await panel.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await observe('final-no-extra-effects');
 expect(external).toEqual([]);save('browser-verdict',{cases:['service','appointment','inventory','multi','stale','hard-block','desktop','mobile','a11y','keyboard'],result:blockedScreens.length?'FUNCTIONAL_WITH_SCREEN_BLOCKERS':'PASS',blockedScreens,external_requests:external,native_voice:voiceCapabilities,voice_proven:false});
 expect(blockedScreens,'Required product screens must refetch successfully before this gate can pass').toEqual([]);
});






