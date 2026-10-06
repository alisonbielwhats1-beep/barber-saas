import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const output=process.env.EXECUTION_E2E_OUTPUT!;
export default defineConfig({testDir:'./secretary-front',workers:1,retries:0,maxFailures:1,timeout:90000,expect:{timeout:15000},
 testMatch:process.env.SECRETARY_FRONT_READ_ONLY_FINISH==='true'?['shell-closure.spec.ts','speech-diagnostic.spec.ts']:process.env.SECRETARY_FRONT_REFRESH_ONLY==='true'?['refresh.spec.ts','speech-diagnostic.spec.ts']:['operational.spec.ts','native-voice.spec.ts'],
 outputDir:resolve(output,'browser-artifacts'),reporter:[['list'],['json',{outputFile:resolve(output,'playwright.json')}]],
 use:{baseURL:'http://127.0.0.1:3157',locale:'pt-BR',timezoneId:'America/Sao_Paulo',viewport:{width:1440,height:900},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{stdout:'pipe',stderr:'pipe',cwd:resolve(__dirname,'..'),command:'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3157',url:'http://127.0.0.1:3157/login',reuseExistingServer:false,timeout:120000},
});


