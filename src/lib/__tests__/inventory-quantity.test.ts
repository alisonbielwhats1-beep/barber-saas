import { describe,it,expect } from "vitest";
import { groundInventoryQuantity, type InventoryQuantityContext } from "../inventory-quantity";
const names=["Óleo Aurora"], now=new Date("2027-04-12T12:00:00Z");
const context=():InventoryQuantityContext=>({draft_ref:"draft",draft_revision:1,expires_at:"2027-04-12T12:30:00Z",product_ref:"backend-product",unit:"un",requested_field:"quantity",published_question:"Quantas unidades ao todo?"});
const check=(quantity:number,source:string,literal?:string,product_names=names,ctx?:InventoryQuantityContext)=>groundInventoryQuantity({quantity,source,literal,product_names,context:ctx,now});
describe("inventory quantities retain their literal catalog-unit basis",()=>{
 it.each([
  [2,"Chegaram duas unidades do Óleo Aurora.","duas unidades"],
  [10,"Chegaram 10un de Óleo Aurora.","10un"],
  [10,"Entraram 10 Óleo Aurora.","10 Óleo Aurora"],
  [3,"Recebi três pomadas.","três pomadas",["Pomada"]],
  [22,"Entraram vinte e duas unidades de Óleo Aurora.","vinte e duas unidades"],
  [105,"Chegaram cento e cinco unidades de Óleo Aurora.","cento e cinco unidades"],
  [2,"Chegaram 2 Óleos Aurora.","2 Óleos Aurora"],
  [3,"Chegaram 3 Shampoo 2 em 1.","3 Shampoo 2 em 1",["Shampoo 2 em 1"]],
 ])("accepts the stated quantity in %s / %s",(quantity,source,literal,products=names)=>{
  expect(check(quantity as number,source as string,literal as string,products as string[]|undefined)).toMatchObject({status:"ACCEPTED",quantity,catalog_unit:"un"});
 });
 it.each(["caixas","pacotes","litros","sacos","gramas","frascos","conjuntos"])("never converts an unsupported measure %s into catalog units",unit=>{
  const result=check(2,`Chegaram duas ${unit} do Óleo Aurora.`,`duas ${unit}`);
  expect(result).toMatchObject({status:"NEEDS_INPUT",count:2,unit_text:unit});expect(result.quantity).toBeUndefined();
 });
 it.each([
  [2,"Chegaram duas caixas do Óleo Aurora.","duas"],
  [2,"Chegaram duas caixas do Óleo Aurora.","duas unidades"],
  [2,"Chegaram doze unidades do Óleo Aurora.","doze unidades"],
  [2,"Chegaram doze unidades do Óleo Aurora.","duas"],
  [2,"Chegaram duas unidades do Óleo Aurora.","duas"],
  [5,"Chegaram 3 embalagens de 5 unidades do Óleo Aurora.","5 unidades"],
  [15,"Chegaram 3 embalagens de 5 unidades do Óleo Aurora.","3 embalagens de 5 unidades"],
  [5,"Cada embalagem tem 5 unidades do Óleo Aurora.","5 unidades"],
  [5,"Chegaram 5 unidades por embalagem do Óleo Aurora.","5 unidades"],
  [3,"Chegaram 3 x 5 unidades do Óleo Aurora.","3"],
  [5,"Chegaram 3 x 5 unidades do Óleo Aurora.","5 unidades"],
  [2,"Não chegaram duas unidades do Óleo Aurora.","duas unidades"],
  [2,"Chegaram 2,5 unidades do Óleo Aurora.","2,5 unidades"],
 ])("fails closed on incomplete, contradictory or composite proof %s / %s",(quantity,source,literal)=>{
  expect(check(quantity as number,source as string,literal as string).status).toBe("NEEDS_INPUT");
 });
 it("guards original legacy count without evidence and preserves direct-unit legacy callers",()=>{
  expect(check(2,"Chegaram duas caixas do Óleo Aurora.").status).toBe("NEEDS_INPUT");
  expect(check(2,"Chegaram duas unidades do Óleo Aurora.")).toMatchObject({status:"ACCEPTED",quantity:2});
  expect(check(2,"Chegaram 2cx de Óleo Aurora.","2cx")).toMatchObject({status:"NEEDS_INPUT",count:2,unit_text:"cx"});
 });
 it("binds independent measures to the named product instead of rejecting all sibling numbers",()=>{
  const source="Entraram 2 unidades do Óleo Aurora e 3 caixas da Pomada Sol.";
  expect(check(2,source,"2 unidades")).toMatchObject({status:"ACCEPTED",quantity:2});
  expect(check(3,source,"3 caixas",["Pomada Sol"]).status).toBe("NEEDS_INPUT");
  expect(check(2,source,"2 unidades",["Pomada Sol"]).status).toBe("NEEDS_INPUT");
 });
 it.each([
  ["Entraram 5 unidades do Shampoo Polar.","5 unidades"],
  ["Shampoo Polar: entraram 5 unidades.","5 unidades"],
  ["Entraram 2 unidades de Óleo Aurora e Shampoo Polar recebeu 5 unidades.","5 unidades"],
  ["Chegaram 3 caixas, com 5 unidades de Óleo Aurora em cada.","5 unidades"],
  ["Chegaram 3 caixas, contendo 5 unidades de Óleo Aurora.","5 unidades"],
  ["Chegaram 3 conjuntos (5 unidades de Óleo Aurora).","5 unidades"],
 ])("does not detach a quantity from its product or measure composition: %s",(source,literal)=>{
  expect(check(5,source,literal).status).toBe("NEEDS_INPUT");
 });
 it.each(["4","quatro"," 4! "])("accepts a bare count only in the live published quantity context: %s",source=>{
  expect(check(4,source,source,names,context())).toMatchObject({status:"ACCEPTED",basis:"CLARIFICATION",quantity:4});
  expect(check(4,source,source).status).toBe("NEEDS_INPUT");
  expect(check(4,source,source,names,{...context(),expires_at:now.toISOString()}).status).toBe("NEEDS_INPUT");
  expect(check(4,source,source,names,{...context(),published_question:"Qual produto?"}).status).toBe("NEEDS_INPUT");
 });
 it("an explicit unit reply uses a live selected product without repeating its name",()=>{
  expect(check(4,"quatro unidades","quatro unidades",names,{...context(),requested_field:undefined,published_question:undefined})).toMatchObject({status:"ACCEPTED",quantity:4});
  expect(check(4,"quatro unidades","quatro unidades").status).toBe("NEEDS_INPUT");
 });
 it.each([
  [24,"Chegaram duas caixas de Óleo Aurora, no total 24 unidades.","24 unidades"],
  [12,"Óleo Aurora: entraram 12 unidades.","12 unidades"],
  [24,"Óleo Aurora: 2 embalagens de 12 unidades, total 24 unidades.","24 unidades"],
 ])("preserves an explicitly supplied catalog-unit total: %s / %s",(quantity,source,literal)=>{
  expect(check(quantity as number,source as string,literal as string)).toMatchObject({status:"ACCEPTED",quantity});
 });
 it.each([
  ["Chegaram 3 caixas de Óleo Aurora, contendo 5 unidades.","5 unidades"],
  ["Óleo Aurora: 3 conjuntos (5 unidades).","5 unidades"],
  ["Entraram 2 unidades do Óleo Aurora; Shampoo Polar: chegaram 5 unidades.","5 unidades"],
 ])("does not confuse retrospective product identity with a factor or sibling: %s",(source,literal)=>{
  expect(check(5,source,literal).status).toBe("NEEDS_INPUT");
 });
});
