import {describe,it,expect} from "vitest";
import {groundInventoryQuantity,type InventoryQuantityWitness,type InventoryQuantityContext} from "../inventory-quantity";

const product="Óleo Aurora",now=new Date("2027-04-12T12:00:00Z");
const context:InventoryQuantityContext={draft_ref:"draft",draft_revision:3,expires_at:"2027-04-12T12:30:00Z",product_ref:"product",unit:"un",requested_field:"quantity",published_question:"Quantas unidades?"};
const check=(source:string,quantity=5,literal?:string,siblings?:InventoryQuantityWitness[],name=product,ctx?:InventoryQuantityContext)=>
 groundInventoryQuantity({source,quantity,literal,product_names:[name],sibling_witnesses:siblings,context:ctx,now});

describe("complete quantity atoms and factual scope",()=>{
 it.each([".",":",";","!","?", ")","-","/","_","+","&","*","'"])("never truncates a product identifier at internal punctuation %s",punctuation=>{
  const name=`Produto X${punctuation}Pro`,source=`Entraram 5 unidades de ${name}.`;
  expect(check(source,5,"5 unidades",undefined,"Produto X").status).toBe("NEEDS_INPUT");
  expect(check(source,5,"5 unidades",undefined,name)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each([['"','"'],["'","'"],["“","”"],["‘","’"],["«","»"]])("preserves only complete product identity within balanced quotes %s%s",(open,close)=>{
  expect(check(`Entraram 5 unidades de ${open}Óleo 2.0${close}.`,5,"5 unidades",undefined,"Óleo 2.0")).toMatchObject({status:"ACCEPTED",quantity:5});
  expect(check(`Entraram 5 unidades de ${open}Óleo 2.0${close}.`,5,"5 unidades",undefined,"Óleo 2").status).toBe("NEEDS_INPUT");
  expect(check(`Entraram 5 unidades de ${open}Óleo 2${close}Premium.`,5,"5 unidades",undefined,"Óleo 2").status).toBe("NEEDS_INPUT");
 });
 it("preserves the original mixed financial/inventory request without treating SKU X as multiplication",()=>{
  expect(check("Quanto faturei ontem e dê entrada em 10 Shampoo X.",10,undefined,undefined,"Shampoo X")).toMatchObject({status:"ACCEPTED",quantity:10});
 });
 it.each(["Shampoo X","Cada Dia","Por Amor","Total","Produto 2 em 1","Shampoo X+2","Shampoo ×2","Produto (X)","Óleo 2.0","Volume 10+","Cinco","Menos","Cerca"])("uses complete product-name spans as identity, not numeric operators: %s",name=>{
  expect(check(`Entraram 5 ${name}.`,5,`5 ${name}`,undefined,name)).toMatchObject({status:"ACCEPTED",quantity:5});
  expect(check(`${name}: entraram 5 unidades.`,5,"5 unidades",undefined,name)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["Shampoo X Premium","Shampoo X+2","Shampoo X-2"])("does not protect an unproved identity prefix or different symbol sequence: %s",mentioned=>{
  const queried=mentioned==="Shampoo X Premium"?"Shampoo X":mentioned==="Shampoo X+2"?"Shampoo X-2":"Shampoo X+2";
  expect(check(`Entraram 5 unidades de ${mentioned}.`,5,"5 unidades",undefined,queried).status).toBe("NEEDS_INPUT");
 });
 it.each(["3 x 5 unidades de Shampoo X","3 × 5 unidades de Shampoo X","5 unidades por caixa de Shampoo X","3 caixas de 5 unidades de Shampoo X"])("keeps operators outside a proved name effective: %s",measure=>{
  expect(check(`Chegaram ${measure}.`,5,"5 unidades",undefined,"Shampoo X").status).toBe("NEEDS_INPUT");
 });
 it.each(["<",">","≤","≥","<=",">=","≈","~","±","∓","menos de ","mais de ","até ","pelo menos ","no máximo ","no mínimo ","cerca de ","aproximadamente ","por volta de ","mais ou menos "])("never drops a numerical bound or approximation operator %s",operator=>{
  const source=`Entraram ${operator}5 unidades do ${product}.`;
  for(const literal of [`${operator}5 unidades`,"5 unidades"])expect(check(source,5,literal).status).toBe("NEEDS_INPUT");
 });
 it("never executes a suffix of a malformed sign chain (Cartesian prefix, spacing, quantity and clipping)",()=>{
  const prefixes=["+","-","−","－","menos"];
  for(const first of prefixes)for(const second of prefixes)for(const space of [""," ","  "])for(const quantity of [1,5,12]){
   const atom=`${first}${space}${second}${space}${quantity}`,source=`Entraram ${atom} unidades do ${product}.`;
   for(const literal of [`${atom} unidades`,`${quantity} unidades`])expect(check(source,quantity,literal).status,`${atom} / ${literal}`).toBe("NEEDS_INPUT");
  }
 });
 it.each([
  ["2.000",2],["12.000",12],["1.200",1.2],["2.00",2],["menos 5",5],["menos 12",12],["–5",5],["－5",5],
  ["sete e cinco",12],["dois e cinco",7],["noventa e vinte",110],["cem e cinco",105],["vinte cinco",25],
 ])("does not reinterpret the numeric grammar of %s as %s",(atom,quantity)=>{
  expect(check(`Entraram ${atom} unidades do ${product}.`,quantity,`${atom} unidades`).status).toBe("NEEDS_INPUT");
 });
 it.each([
  ["2.000",2000],["12.000",12000],["1.200",1200],["100.000",100000],["vinte e cinco",25],
  ["cento e cinco",105],["duzentos e vinte e dois",222],["dois mil cento e cinco",2105],["dois mil e quinze",2015],["cem mil",100000],
 ])("preserves the complete catalog count %s",(atom,quantity)=>{
  expect(check(`Entraram ${atom} unidades do ${product}.`,quantity,`${atom} unidades`)).toMatchObject({status:"ACCEPTED",quantity});
 });
 it.each(["-5","−5","- 5","menos cinco","-5,5","-5.5","5/2","5 / 2","2.5","2,5"])("cannot clip or discard part of the atom %s",atom=>{
  const source=`Entraram ${atom} unidades do ${product}.`;
  for(const literal of [undefined,`${atom} unidades`,"5 unidades"]){expect(check(source,5,literal).status).toBe("NEEDS_INPUT");}
 });
 it.each(["+5un","+ 5 un","5un","5 un","5un.","5 un.","cinco un.","cinco unidades"])("preserves an explicit integer measure %s",measure=>{
  expect(check(`Entraram ${measure} do ${product}.`,5,measure)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["Premium","2","Intenso","- Extra","(Premium)"])("does not mistake an identity prefix for a complete product %s",suffix=>{
  expect(check(`Entraram 5 unidades do ${product} ${suffix}.`,5,"5 unidades").status).toBe("NEEDS_INPUT");
 });
 it.each(["Shampoo 2 em 1","Óleo 12","Produto A"])("does not treat complete product identifiers as quantities: %s",name=>{
  expect(check(`Entraram 5 unidades do ${name}.`,5,"5 unidades",undefined,name)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["caixas, todas contendo exatamente","recipientes com capacidade para","pacotes, com aproximadamente","conjuntos (","agrupamentos: em cada um há"])("does not treat an inner measure as the total: %s",bridge=>{
  expect(check(`Chegaram 3 ${bridge} 5 unidades do ${product}.`,5,"5 unidades").status).toBe("NEEDS_INPUT");
 });
 it.each(["caixas, todas contendo exatamente","recipientes com capacidade para","conjuntos, com"])("accepts the separately stated catalog total after %s",bridge=>{
  expect(check(`Chegaram 3 ${bridge} 5 unidades do ${product}, total 15 unidades.`,15,"15 unidades")).toMatchObject({status:"ACCEPTED",quantity:15});
 });
 it.each(["Nem","Não","Nunca","Jamais"])("does not execute a negated measure (%s)",polarity=>{
  expect(check(`${polarity} entraram 5 unidades do ${product}.`,5,"5 unidades").status).toBe("NEEDS_INPUT");
 });
 it.each(["Corrigindo: entraram","A quantidade é","Na realidade chegaram"])("does not hide an unassigned contrary count behind the clipped first witness: %s",bridge=>{
  expect(check(`Entraram 5 unidades de ${product}. ${bridge} 7 unidades.`,5,`5 unidades de ${product}`).status).toBe("NEEDS_INPUT");
 });
 it("rejects a subject introduced in the current turn despite an active product context",()=>{
  expect(check("Shampoo Polar recebeu 5 unidades.",5,"5 unidades",undefined,product,context).status).toBe("NEEDS_INPUT");
  expect(check("5 unidades",5,"5 unidades",undefined,product,context)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it("requires distinct, complete current witnesses for independent values of the same product",()=>{
  const source=`Entraram 5 unidades de ${product}; saíram 2 unidades de ${product}.`;
  const witnesses=[{quantity:5,literal:`5 unidades de ${product}`,product_name:product},{quantity:2,literal:`2 unidades de ${product}`,product_name:product}];
  for(const witness of witnesses){
   expect(check(source,witness.quantity,witness.literal).status).toBe("NEEDS_INPUT");
   expect(check(source,witness.quantity,witness.literal,witnesses)).toMatchObject({status:"ACCEPTED",quantity:witness.quantity});
  }
  for(const invalid of [[],[{...witnesses[1],literal:"2 unidades"}],[{...witnesses[1],quantity:7}],[{...witnesses[1],literal:witnesses[0].literal}],[{...witnesses[1],product_name:"Shampoo Polar"}]]){
   expect(check(source,5,witnesses[0].literal,invalid).status).toBe("NEEDS_INPUT");
  }
 });
 it("a sibling witness cannot launder an inner factor or negate an unassigned value",()=>{
  const source=`Entraram 5 unidades de ${product}; chegaram 3 caixas contendo 2 unidades de ${product}.`;
  expect(check(source,5,`5 unidades de ${product}`,[{quantity:2,literal:`2 unidades de ${product}`,product_name:product}]).status).toBe("NEEDS_INPUT");
 });
});
