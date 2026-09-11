import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertSafeDatabaseOperation } from "../../src/lib/database-safety";

test.describe("@database Everflare HQ",()=>{
 test.skip(!process.env.RUN_DATABASE_E2E,"Somente CI descartável.");
 let email:string;const password="hq-synthetic-2026-password";
 test.beforeAll(async()=>{
  assertSafeDatabaseOperation(process.env,{operation:"hq-browser-fixture"});
  const db=new PrismaClient();
  email=crypto.randomUUID()+"@hq.example.test";
  const admin=await db.user.create({data:{email,name:"Responsável HQ",platformRole:"SUPER_ADMIN",passwordHash:await bcrypt.hash(password,10),passwordSetAt:new Date()}});
  await db.hqAgentRun.create({data:{id:crypto.randomUUID(),actorId:admin.id,question:"Resumo sintético persistente do Chefe",answer:"Resposta fictícia do teste de histórico. Nenhum serviço externo foi utilizado.",snapshot:{synthetic:true},sources:[{label:"Financeiro",href:"/hq/finance"}],status:"completed",model:"synthetic-browser",promptVersion:"ci",chargeMicros:0,inputTokens:1,outputTokens:1,finishedAt:new Date()}});
  await db.$disconnect();
 });
 test("bloqueia visitante e proprietário comum",async({page})=>{
  await page.goto("/hq/dashboard");await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill("dono@lunahair.com");
  await page.getByLabel("Senha",{exact:true}).fill("demo1234");
  await page.getByRole("button",{name:"Entrar",exact:true}).click();
  await expect(page).toHaveURL(/\/(hoje|dashboard)$/);
  await page.goto("/hq/dashboard");await expect(page).not.toHaveURL(/\/hq/);
  await expect(page.getByRole("heading",{name:"Visão executiva"})).toHaveCount(0);
 });
 test("cria lead, converte cliente e valida telas em quatro resoluções",async({page})=>{
  test.setTimeout(300000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const business="Estúdio Aurora HQ "+crypto.randomUUID().slice(0,8);
  await page.goto("/login");await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Entrar",exact:true}).click();
  await expect(page).toHaveURL(/\/plataforma/,{timeout:30000});
  await page.goto("/hq/leads/new");
  await page.getByLabel("Nome *",{exact:true}).fill("Marina HQ sintética");
  await page.getByLabel("Estabelecimento *",{exact:true}).fill(business);
  await page.getByLabel("E-mail",{exact:true}).fill("marina@hq.example.test");
  await page.getByRole("button",{name:"Salvar lead",exact:true}).click();
  await expect(page).toHaveURL(/\/hq\/leads\/[0-9a-f-]{36}$/,{timeout:20000});
  await expect(page.getByRole("heading",{name:business,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Converter em cliente",exact:true}).click();
  await expect(page.locator(".hq-profile").getByText("Convertido",{exact:true})).toBeVisible();
  await page.goto("/hq/customers?q="+encodeURIComponent(business));
  await page.getByRole("link",{name:business,exact:true}).click();
  const profile=new URL(page.url()).pathname;
  await expect(page.getByRole("heading",{name:"Histórico completo"})).toBeVisible();
  await expect(page.getByText("Lead convertido em cliente. Histórico preservado.")).toBeVisible();
  for(const viewport of [{width:1440,height:1000},{width:1024,height:900},{width:768,height:1024},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const route of ["/hq/dashboard","/hq/cmm","/hq/pipeline","/hq/finance",profile,"/hq/support","/hq/product","/hq/agents"]){
    await page.goto(route);await expect(page.locator(".hq-main h1")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
    const audit=await new AxeBuilder({page}).include(".hq").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({path:test.info().outputPath("hq-"+route.split("/").filter(Boolean).slice(1).join("-")+"-"+viewport.width+".png"),fullPage:true,animations:"disabled"});
   }
  }
  expect(errors).toEqual([]);
 });
 test("valida laboratório SDK sem dados ou serviços externos",async({page})=>{
  test.setTimeout(120000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Entrar",exact:true}).click();
  await expect(page).toHaveURL(/\/plataforma/,{timeout:30000});
  await page.goto("/hq/agents");
  await expect(page.getByRole("button",{name:"Consultar Chefe",exact:true})).toBeDisabled();
  await expect(page.getByText("Resumo sintético persistente do Chefe",{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText("Resumo sintético persistente do Chefe",{exact:true})).toBeVisible();
  await expect(page.getByText("Simulação local · sem consumo de IA",{exact:true})).toBeVisible();
  await page.getByLabel("Cenário de validação").selectOption("hours");
  await page.getByRole("button",{name:"Executar cenário",exact:true}).click();
  await expect(page.getByRole("region",{name:"Resultado da execução"})).toContainText("KB-DEMO-001");
  await page.getByRole("button",{name:"Validar os 7 cenários",exact:true}).click();
  await expect(page.getByRole("button",{name:"Executar cenário",exact:true})).toBeEnabled({timeout:30000});
  await expect(page.getByRole("cell",{name:"Conforme esperado",exact:true})).toHaveCount(8);
  await expect(page.getByRole("cell",{name:"Revisar",exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  const audit=await new AxeBuilder({page}).include(".hq").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({path:test.info().outputPath("hq-agents-results-mobile.png"),fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Limpar resultados",exact:true}).click();
  await expect(page.getByText("Nenhuma execução nesta sessão.",{exact:true})).toBeVisible();
 });
});
