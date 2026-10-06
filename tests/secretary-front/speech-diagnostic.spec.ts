import { test, expect, chromium } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out=process.env.EXECUTION_E2E_OUTPUT!;
test('diagnose native capture versus recognition; never submit synthetic speech',async()=>{
 test.setTimeout(120000);
 const fixture=JSON.parse(readFileSync(resolve(out,'fixture.json'),'utf8'));
 const browser=await chromium.launch({channel:'chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('packages/salon-secretary/evaluation/results/front-voice/synthetic-request.wav')}`]});
 try{
 const context=await browser.newContext({permissions:['microphone'],locale:'pt-BR',viewport:{width:390,height:844}});
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:3157/login');await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Senha',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/\/(pos-login|hoje|dashboard)/,{timeout:60000});
 const response=await page.goto('http://127.0.0.1:3157/servicos');
 await page.getByRole('button',{name:'Abrir Secretária',exact:true}).click();
 const capture=await page.evaluate(async()=>{
  const permission=await navigator.permissions.query({name:'microphone' as PermissionName});
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});const track=stream.getAudioTracks()[0];
   const ac=new AudioContext();await ac.resume();const source=ac.createMediaStreamSource(stream),analyser=ac.createAnalyser();source.connect(analyser);analyser.fftSize=2048;
   const data=new Float32Array(analyser.fftSize),rms:number[]=[];
   await new Promise<void>(resolve=>{const timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);rms.push(Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length));if(rms.length===45){clearInterval(timer);resolve();}},100);});
   const result={permission:permission.state,trackState:track.readyState,muted:track.muted,settings:track.getSettings(),rms,maxRms:Math.max(...rms),audioContext:ac.state};
   stream.getTracks().forEach(t=>t.stop());await ac.close();return result;
  }catch(e){return {permission:permission.state,error:e instanceof Error?e.name:String(e)};}
 });
 const direct=await page.evaluate(async()=>{
  type Native=EventTarget & {lang:string;continuous:boolean;interimResults:boolean;processLocally?:boolean;start():void;abort():void};
  const w=window as Window & {SpeechRecognition?:new()=>Native;webkitSpeechRecognition?:new()=>Native};const Constructor=w.SpeechRecognition??w.webkitSpeechRecognition;
  if(!Constructor)return {available:false};
  const rec=new Constructor();rec.lang='pt-BR';rec.continuous=false;rec.interimResults=true;
  const started=performance.now();const events:{type:string;ms:number;error?:string}[]=[];let transcript='';
  return await new Promise(resolve=>{
   const timer=setTimeout(()=>{events.push({type:'diagnostic-timeout',ms:performance.now()-started});rec.abort();finish();},16000);
   function finish(){clearTimeout(timer);resolve({available:true,processLocallySupported:'processLocally' in rec,processLocally:rec.processLocally??null,events,transcript});}
   for(const type of ['start','audiostart','soundstart','speechstart','speechend','soundend','audioend','error','end','result'])rec.addEventListener(type,event=>{
    const e=event as Event & {error?:string;results?:ArrayLike<{0:{transcript:string}}>};events.push({type,ms:performance.now()-started,...(e.error?{error:e.error}:{})});
    if(e.results)transcript=Array.from(e.results).map(r=>r[0].transcript).join(' ');if(type==='end')finish();
   });
   try{rec.start();}catch(e){events.push({type:'start-exception',ms:performance.now()-started,error:String(e)});finish();}
  });
 });
 const panel=page.getByRole('dialog',{name:'Secretária',exact:true});
 await panel.getByRole('button',{name:'Falar com a Secretária'}).click();
 await expect(panel.getByRole('alert')).toBeVisible({timeout:20000}).catch(()=>{});
 const front={transcript:await panel.getByRole('textbox',{name:'Mensagem'}).inputValue(),alerts:await panel.getByRole('alert').allTextContents(),status:await panel.getByRole('status').innerText()};
 await page.screenshot({path:resolve(out,'native-speech-diagnostic.png')});
 // UI retry and text fallback are checked without ever sending or confirming.
 const retry=panel.getByRole('button',{name:'Falar com a Secretária'});
 if(await retry.isVisible()){await retry.click();await expect(panel.getByRole('button',{name:'Cancelar gravação'})).toBeVisible();await panel.getByRole('button',{name:'Cancelar gravação'}).click();}
 await panel.getByRole('textbox',{name:'Mensagem'}).fill('Fallback digitado sem enviar');await expect(panel.getByRole('button',{name:'Enviar',exact:true})).toBeEnabled();await expect(panel.getByRole('button',{name:'Confirmar',exact:true})).toHaveCount(0);
 writeFileSync(resolve(out,'speech-diagnostic.json'),JSON.stringify({browser:browser.version(),engine:'Installed Chrome headless; synthetic WAV; no real human microphone',permissionsPolicy:response?.headers()['permissions-policy'],capture,direct,front,retry_and_text_fallback:'PASS',sent:false,confirmed:false,real_device:'REQUIRES_REAL_DEVICE_VALIDATION'},null,2));
 }finally{await browser.close();}
});
