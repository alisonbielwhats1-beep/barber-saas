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
  await db.user.create({data:{email,name:"Responsável HQ",platformRole:"SUPER_ADMIN",passwordHash:await bcrypt.hash(password,10),passwordSetAt:new Date()}});
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
  await page.goto("/login");await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Entrar",exact:true}).click();
  await expect(page).toHaveURL(/\/plataforma/,{timeout:30000});
  await page.goto("/hq/leads/new");
  await page.getByLabel("Nome *",{exact:true}).fill("Marina HQ sintética");
  await page.getByLabel("Estabelecimento *",{exact:true}).fill("Estúdio Aurora HQ");
  await page.getByLabel("E-mail",{exact:true}).fill("marina@hq.example.test");
  await page.getByRole("button",{name:"Salvar lead",exact:true}).click();
  await expect(page).toHaveURL(/\/hq\/leads\/[0-9a-f-]{36}$/,{timeout:20000});
  await expect(page.getByRole("heading",{name:"Estúdio Aurora HQ",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Converter em cliente",exact:true}).click();
  await expect(page.getByText("Convertido",{exact:true})).toBeVisible();
  await page.goto("/hq/customers?q=Estúdio+Aurora+HQ");
  await page.getByRole("link",{name:"Estúdio Aurora HQ",exact:true}).click();
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
});

