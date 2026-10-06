import {describe,it,expect} from "vitest";
import {groundInventoryQuantity,sourceHasInventoryCount,inventoryProductCorrectionInSource} from "../inventory-quantity";
const name="Shampoo X",measure="2 unidades do Shampoo X";
const check=(source:string,quantity=2,literal=measure)=>groundInventoryQuantity({source,quantity,literal,product_names:[name]});
describe("inventory facts keep explicit numeric dimensions separate",()=>{
 it.each([1,2,5,10])("preserves object dimensions of sibling facts with %s catalog units",quantity=>{
  for(const connector of ["de","por"]){
   const source=`Uma comanda de R$ 80, dê entrada em ${quantity} Shampoo X e crie um serviço ${connector} R$ 25 com duração de 15 minutos.`;
   expect(check(source,quantity,`${quantity} Shampoo X`)).toMatchObject({status:"ACCEPTED",quantity});
  }
 });
 it.each(["um serviço","duas comandas","3 agendamentos","um cliente","4 profissionais"])("keeps the ERP object dimension separate: %s",dimension=>{
  expect(check(`${dimension}; saíram ${measure}.`)).toMatchObject({status:"ACCEPTED",quantity:2});
 });
 it.each(["Serviço","Comanda","Agendamento","Cliente","Profissional"])("gives complete catalog identity precedence over ERP type %s",product=>{
  expect(groundInventoryQuantity({source:`Entraram 2 ${product}.`,quantity:2,literal:`2 ${product}`,product_names:[product]})).toMatchObject({status:"ACCEPTED",quantity:2});
  expect(groundInventoryQuantity({source:`Entraram 2 ${product} Premium.`,quantity:2,literal:`2 ${product}`,product_names:[product]}).status).toBe("NEEDS_INPUT");
 });
 it.each(["uma caixa com 2 unidades","um pacote com 2 unidades","2 unidades por serviço","3 serviços com 2 unidades por comanda","um serviçox com 2 unidades"])("does not discard a package, unknown object or external factor: %s",fact=>{
  expect(check(`Chegaram ${fact} do ${name}.`,2,`2 unidades`).status).toBe("NEEDS_INPUT");
 });
 it("cannot execute an ERP object count as product units",()=>{
  expect(check(`${name}; 2 serviços.`,2,"2 serviços").status).toBe("NEEDS_INPUT");
 });
 it.each(["R$80","BRL 80","oitenta reais"])("does not mistake a proved price for foreign product identity before an explicit total: %s",price=>{
  const source=`Chegou uma caixa de ${price} com 5 unidades do ${name}, total 5 unidades.`;
  expect(check(source,5,"5 unidades")).toMatchObject({status:"ACCEPTED",quantity:5});
  expect(check(`Chegou uma caixa de ${price} com 5 unidades do ${name}.`,5,"5 unidades").status).toBe("NEEDS_INPUT");
 });
 it("uses the same dimensions when deciding whether the current turn changes quantity",()=>{
  expect(sourceHasInventoryCount("Preço: R$80; duração: 15 minutos.",[name])).toBe(false);
  expect(sourceHasInventoryCount("Preço: R$80; quantidade: 7.",[name])).toBe(true);
 });
 it("does not treat a factual price as a contradictory count when revalidating a corrected identity",()=>{
  expect(inventoryProductCorrectionInSource(`${name}; preço: R$80.`,[name])).toBe(true);
  expect(inventoryProductCorrectionInSource(`${name}; quantidade: 7.`,[name])).toBe(false);
  expect(inventoryProductCorrectionInSource(`Não é ${name}; preço: R$80.`,[name])).toBe(false);
 });
 it("preserves the historical mixed-action roles with full factual source",()=>{
  const source="Altera Massagem para R$80; dá baixa em 2 unidades do Shampoo X; cadastra Barba Expressa por R$25 com 15 minutos.";
  expect(check(source)).toMatchObject({status:"ACCEPTED",quantity:2});
 });
 it.each(["R$80","R$ 25,50","BRL 20","vinte reais","150 centavos","15 minutos","45min","duas horas","30 segundos","14:30","9:05","2027-04-14","14/04/2027"])("does not mistake complete explicit dimension %s for a count",dimension=>{
  for(const source of [`Outro dado: ${dimension}; saíram ${measure}.`,`Saíram ${measure}; outro dado: ${dimension}.`])
   expect(check(source)).toMatchObject({status:"ACCEPTED",quantity:2});
 });
 it.each(["R$2","2 reais","2 minutos","2:30","02/04/2027"])("cannot execute %s as catalog units",dimension=>{
  const source=`${name}: ${dimension}.`;
  expect(check(source,2,dimension).status).toBe("NEEDS_INPUT");
 });
 it.each(["2:3","25:30","14:99","5/2","31/02/2027","2027-02-31","R$2.00","15minutosX","5","3 caixas","3 x 5 unidades"])("keeps unknown, malformed and compound numeric facts unresolved: %s",dimension=>{
  expect(check(`Saíram ${measure}; outro dado: ${dimension}.`).status).toBe("NEEDS_INPUT");
 });
 it("cannot use a clipped currency or duration proof to borrow the stock count elsewhere",()=>{
  const source=`R$2; 2 minutos; saíram ${measure}.`;
  expect(check(source,2,"R$2").status).toBe("NEEDS_INPUT");
  expect(check(source,2,"2 minutos").status).toBe("NEEDS_INPUT");
  expect(check(source)).toMatchObject({status:"ACCEPTED",quantity:2});
 });
 it("preserves stock negation and unassigned contradictory quantity beside other dimensions",()=>{
  expect(check(`R$80; não saíram ${measure}; 15 minutos.`).status).toBe("NEEDS_INPUT");
  expect(check(`R$80; saíram ${measure}; saíram 7 unidades; 15 minutos.`).status).toBe("NEEDS_INPUT");
 });
 it.each([1,2,5,10])("preserves %s independent inventory scopes alongside other explicit dimensions",size=>{
  const witnesses=Array.from({length:size},(_,index)=>({quantity:index+1,literal:`${index+1} unidades do ${name}`,product_name:name}));
  const source=["Preço: R$80",...witnesses.map(witness=>`Movimento: ${witness.literal}`),"Duração: 15 minutos","Horário: 14:30"].join("; ")+".";
  for(const witness of witnesses){
   expect(groundInventoryQuantity({source,quantity:witness.quantity,literal:witness.literal,product_names:[name],sibling_witnesses:witnesses})).toMatchObject({status:"ACCEPTED",quantity:witness.quantity});
  }
 });
});
