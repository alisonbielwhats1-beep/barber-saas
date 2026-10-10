import { test, expect, chromium } from '@playwright/test';
import { openSecretary } from './open-secretary';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out=process.env.EXECUTION_E2E_OUTPUT!;
test('native browser speech input with synthetic Portuguese audio; no send or confirmation',async()=>{
 test.setTimeout(120000);
 const fixture=JSON.parse(readFileSync(resolve(out,'fixture.json'),'utf8'));
 const browser=await chromium.launch({channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('packages/salon-secretary/evaluation/results/front-voice/synthetic-request.wav')}`]});
 try{
 const context=await browser.newContext({permissions:['microphone'],locale:'pt-BR',viewport:{width:390,height:844}});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:3157/login');await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page).toHaveURL(/\/(pos-login|hoje|dashboard)/,{timeout:60000});
 await page.goto('http://127.0.0.1:3157/servicos');await openSecretary(page);
 const panel=page.getByRole('dialog',{name:'Secretária',exact:true});
 await panel.getByRole('button',{name:'Falar com a Secretária'}).click();
 let recognized=false;
 try{await expect(panel.getByRole('textbox',{name:'Mensagem'})).toHaveValue(/massagem/i,{timeout:20000});recognized=true;}catch{/* Persist actual unsupported/service error; never claim a transcription pass. */}
 const transcript=await panel.getByRole('textbox',{name:'Mensagem'}).inputValue();
 const result={engine:'Installed Chrome, native SpeechRecognition; synthetic WAV via fake microphone',recognized,transcript,status:await panel.getByRole('status').innerText(),errors:await panel.getByRole('alert').allTextContents(),sent:false,confirmed:false};
 writeFileSync(resolve(out,'native-voice-result.json'),JSON.stringify(result,null,2));
 await page.screenshot({path:resolve(out,'native-voice-mobile.png')});
 if(recognized){await panel.getByRole('button',{name:'Parar gravação'}).click().catch(()=>{});await expect(panel.getByRole('textbox',{name:'Mensagem'})).toBeEnabled();await panel.getByRole('textbox',{name:'Mensagem'}).fill('Transcrição revisada manualmente');await expect(panel.getByRole('button',{name:'Enviar',exact:true})).toBeEnabled();}
 await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});
