import {describe,it,expect} from "vitest";
import {groundInventoryQuantity,type InventoryQuantityContext} from "../inventory-quantity";
import {inventorySourceScopes} from "../inventory-source-scope";
import fixture from "../../test/fixtures/secretary-real-wire-golden10-inventory.json";
import golden11 from "../../test/fixtures/secretary-real-wire-golden11-inventory.json";
import {decodeInventoryQuantityPayload,inventoryReference} from "../../../packages/salon-secretary/src/inventory-skill";
const now=new Date("2027-04-12T12:00:00Z"),names=["Óleo Aurora"],catalog=[{id:"a",name:names[0]},{id:"b",name:"Shampoo Polar"}];
const context=():InventoryQuantityContext=>({draft_ref:"draft",draft_revision:2,product_ref:"a",product_revision:"a".repeat(64),unit:"un",expires_at:"2027-04-12T12:30:00Z",requested_field:"quantity",published_question:"Quantas unidades ao todo?"});
const check=(source:string,extra:Partial<Parameters<typeof groundInventoryQuantity>[0]>={})=>groundInventoryQuantity({source,quantity:5,literal:"5 unidades",product_names:names,catalog,now,...extra});
describe("inventory semantic roles preserve literal factual boundaries",()=>{
 it("GF28 v11 original NEW preserves proved identity despite an unbound CURRENT_FIELD hint",()=>{
  const row=golden11.cases.find(value=>value.case_id==="GF28")!;
  const parsed=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:{source_scope:string;inventory:{quantity:number;quantity_evidence:string;reference:{kind:"CURRENT_FIELD";literal:null}}}[]}};
  const op=parsed.turn.operations[0];
  expect(check(row.source,{quantity:op.inventory.quantity,literal:op.inventory.quantity_evidence,reference:op.inventory.reference,source_scope:op.source_scope})).toMatchObject({status:"NEEDS_INPUT",cause:"UNIT_UNPROVEN"});
 });
 it("GF29 v11 original repaired scopes preserve a connector outside its sibling scope",()=>{
  for(const row of golden11.cases.filter(value=>value.case_id==="GF29")){
   const parsed=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:{operation:string;item_key:string;source_scope:string;inventory?:{quantity:number;quantity_evidence:string}}[]}};
   const op=parsed.turn.operations.find(value=>value.operation==="stock.movement")!;
   const actual=check(row.source,{quantity:op.inventory!.quantity,literal:op.inventory!.quantity_evidence,source_scope:op.source_scope,operation_scopes:parsed.turn.operations.filter(value=>value!==op).map(value=>({key:value.item_key,operation:value.operation,literal:value.source_scope}))});
   expect(actual).toMatchObject(row.attempt===42?{status:"ACCEPTED",quantity:4}:{status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
  }
 });
 it.each(["e","mas"])("sibling scope may begin immediately after the actual %s separator",connector=>{
  const source=`Entraram 5 unidades de Óleo Aurora ${connector} confira o relatório.`;
  expect(check(source,{source_scope:"Entraram 5 unidades de Óleo Aurora",operation_scopes:[{key:"read",operation:"financial.report",literal:"confira o relatório."}]})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["Óleo Aurora","Shampoo X","Cinco"])("a CURRENT_FIELD hint cannot override independent full named facts: %s",name=>{
  expect(check(`Entraram 5 unidades de ${name}.`,{product_names:[name],catalog:[{id:"p",name}],reference:{kind:"CURRENT_FIELD",literal:null}})).toMatchObject({status:"ACCEPTED",quantity:5});
  expect(check(`Entraram 5 unidades de ${name} Premium.`,{product_names:[name],catalog:[{id:"p",name}],reference:{kind:"CURRENT_FIELD",literal:null}})).toMatchObject({status:"NEEDS_INPUT",cause:"PRODUCT_UNPROVEN"});
 });
 it.each(["São 5 unidades.","Entraram 5 unidades de Shampoo Polar."])("an unbound hint cannot supply a missing named reference: %s",source=>{
  expect(check(source,{reference:{kind:"CURRENT_FIELD",literal:null}})).toMatchObject({status:"NEEDS_INPUT",cause:"PRODUCT_UNPROVEN"});
 });
 it.each(["Entraram -5 unidades de Óleo Aurora.","Nem 5 unidades de Óleo Aurora.","Chegaram 3 caixas com 5 unidades de Óleo Aurora.","Entraram 5 unidades de Óleo Aurora por caixa."])("independent name with wrong contextual hint cannot override quantity facts: %s",source=>{
  expect(check(source,{reference:{kind:"CURRENT_FIELD",literal:null}}).status).toBe("NEEDS_INPUT");
 });
 it("a connector outside a sibling scope cannot launder an actual catalog variant",()=>{
  const source="Entraram 5 unidades de Óleo Aurora e Corpo.";
  expect(check(source,{source_scope:"Entraram 5 unidades de Óleo Aurora",operation_scopes:[{key:"read",operation:"financial.report",literal:"Corpo."}],catalog:[...catalog,{id:"variant",name:"Óleo Aurora e Corpo"}]})).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
 });
 it.each(["Produto E","Produto Mas"].flatMap(name=>[undefined,{kind:"CURRENT_FIELD" as const,literal:null}].flatMap(reference=>[false,true].map(own=>({name,reference,own})))))("expanded sibling boundaries cannot consume original identity: %j",({name,reference,own})=>{
  const ownScope=`São 5 unidades de ${name}`;
  const input={product_names:[name],catalog:[{id:"a",name}],context:context(),reference,...(own?{source_scope:ownScope}:{}),operation_scopes:[{key:"read",operation:"financial.report",literal:"Relatório"}]};
  expect(check(`${ownScope} Relatório.`,input)).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
  // A second, external separator remains available to the semantic sibling.
  expect(check(`${ownScope} e Relatório.`,input)).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["E","Mas"].flatMap(name=>[undefined,{kind:"CURRENT_FIELD" as const,literal:null}].flatMap(reference=>[false,true].map(own=>({name,reference,own})))))("an expansion cannot consume the entire measure reference: %j",({name,reference,own})=>{
  const ownScope=`São 5 unidades de ${name}`;
  const input={product_names:[name],catalog:[{id:"a",name}],context:context(),reference,...(own?{source_scope:ownScope}:{}),operation_scopes:[{key:"read",operation:"financial.report",literal:"Relatório"}]};
  expect(check(`${ownScope} Relatório.`,input)).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
  expect(check(`${ownScope} e Relatório.`,input)).toMatchObject({status:"ACCEPTED",quantity:5});
  expect(check("São 5 unidades e Relatório.",{...input,...(own?{source_scope:"São 5 unidades"}:{})})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it("replays original GF27 without adding reference or scope",()=>{
  const original=fixture.cases.find(row=>row.case_id==="GF27")!;
  const op=(decodeInventoryQuantityPayload(JSON.parse(original.raw_arguments)) as {turn:{operations:{inventory:{quantity:number;quantity_evidence:string;reason:string}}[]}}).turn.operations[0].inventory;
  expect(check(original.source,{quantity:op.quantity,literal:op.quantity_evidence,reason:op.reason})).toMatchObject({status:"ACCEPTED",quantity:3});
 });
 it.each(["para uso nos atendimentos","porque a equipe solicitou","pois há necessidade","por solicitação da equipe"])("accepts a literal semantic complement at grammatical boundary: %s",reason=>{
  const source=`Saíram 5 unidades de Óleo Aurora ${reason}.`;
  expect(check(source,{reason,source_scope:source,reference:{kind:"NAMED",literal:"Óleo Aurora"}})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each(["Premium","2.0","X.Pro","-Novo","/Extra"])("a reason role cannot launder an adjacent variant %s",variant=>{
  const source=`Entraram 5 unidades de Óleo Aurora ${variant}.`;
  expect(check(source,{reason:variant,source_scope:source,reference:{kind:"NAMED",literal:"Óleo Aurora"}}).status).toBe("NEEDS_INPUT");
 });
 it.each(["para Barba","e Corpo"])("a more specific actual catalog entity prevails over a semantic role %s",suffix=>{
  const source=`Entraram 5 unidades de Óleo Aurora ${suffix}.`;
  expect(check(source,{reason:suffix,reference:{kind:"NAMED",literal:"Óleo Aurora"},catalog:[...catalog,{id:"specific",name:`Óleo Aurora ${suffix}`}]})).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
  expect(check(source,{quantity:5,product_names:[`Óleo Aurora ${suffix}`],reference:{kind:"NAMED",literal:`Óleo Aurora ${suffix}`},catalog:[...catalog,{id:"specific",name:`Óleo Aurora ${suffix}`}]}).status).toBe("ACCEPTED");
 });
 it("a fresh sibling scope supplies GF29 boundary without discarding its numeric facts",()=>{
  const source=fixture.cases.find(row=>row.case_id==="GF29")!.source;
  const stock="dá entrada em quatro Óleos Aurora",read="e mostra o que recebi na semana passada.";
  expect(check(source,{quantity:4,literal:"quatro Óleos Aurora",source_scope:stock,reference:{kind:"NAMED",literal:"Óleos Aurora"},operation_scopes:[{key:"service",operation:"service.create",literal:"Cria o serviço Toque de Luz por R$42 e 25 minutos,"},{key:"read",operation:"financial.report",literal:read}]})).toMatchObject({status:"ACCEPTED",quantity:4});
 });
 it.each(["São doze unidades no total.","Ao todo: doze unidades.","doze unidades no total","São doze unidades ao todo.","Pode registrar doze unidades mesmo.","doze unidades, certinho."])("server pending quantity binds current reply without mandatory model tag: %s",source=>{
  expect(check(source,{quantity:12,literal:source.includes("no total")?"doze unidades no total":"doze unidades",context:context()})).toMatchObject({status:"ACCEPTED",quantity:12});
 });
 it.each(["Shampoo Polar recebeu 5 unidades.","São 5 unidades de Shampoo Polar."])("current reply cannot steal another factual product: %s",source=>{
  expect(check(source,{context:context(),reference:{kind:"CURRENT_FIELD",literal:null}})).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
 });
 it.each([" Premium"," 2.0"," X.Pro"," -Novo"," /Extra","2.0","X.Pro","-Novo","/Extra"])("a bound quantity reply cannot clip an explicit identifier continuation: %s",suffix=>{
  for(const reference of [undefined,{kind:"CURRENT_FIELD" as const,literal:null}]){
   expect(check(`São 5 unidades de Óleo Aurora${suffix}.`,{context:context(),reference})).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
  }
 });
 it.each(["Entraram 5","Entraram 5 unidades de Óleo"])("own scope must contain its complete measure and attached reference: %s",source_scope=>{
  expect(check("Entraram 5 unidades de Óleo Aurora.",{source_scope})).toMatchObject({status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
 });
 it("own scope must contain the whole literal even when the count and unit fit",()=>{
  expect(check("Entraram 5 unidades de Óleo Aurora.",{source_scope:"Entraram 5 unidades",literal:"5 unidades de Óleo Aurora"})).toMatchObject({status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
 });
 it("bare quantity replies also require their complete current literal within the scope",()=>{
  expect(check("5.",{literal:"5.",source_scope:"5",context:context()})).toMatchObject({status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
  expect(check("5.",{literal:"5",source_scope:"5",context:context()})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it("an absent own scope cannot consume quantity evidence assigned to a sibling",()=>{
  const source="Entraram 5 unidades de Óleo Aurora.";
  expect(check(source,{operation_scopes:[{key:"sibling",operation:"stock.movement",literal:source}]})).toMatchObject({status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
  expect(check("5",{literal:undefined,context:context(),operation_scopes:[{key:"sibling",operation:"stock.movement",literal:"5"}]})).toMatchObject({status:"NEEDS_INPUT",cause:"PROOF_INVALID"});
 });
 it("a scoped retrospective reference must remain inside the same current operation",()=>{
  expect(check("Óleo Aurora; entraram 5 unidades.",{source_scope:"entraram 5 unidades."}).status).toBe("NEEDS_INPUT");
 });
 it.each(["Óleo Aurora Premium","Óleo Aurora2.0","Óleo Aurora X.Pro","Óleo Aurora-Novo"])("a complete bound identifier remains valid: %s",name=>{
  expect(check(`São 5 unidades de ${name}.`,{context:context(),product_names:[name],catalog:[{id:"a",name}]})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each([["Cinco","cinco",5],["Um","uma",1],["Dois","dois",2]] as const)("a current count+unit remains a measure when the product name is %s",(name,cardinal,quantity)=>{
  expect(check(`São ${cardinal} unidades.`,{quantity,literal:`${cardinal} unidades`,context:context(),product_names:[name],catalog:[{id:"a",name}]})).toMatchObject({status:"ACCEPTED",quantity});
  expect(check(`São ${quantity} unidades de ${name} Premium.`,{quantity,literal:`${quantity} unidades`,context:context(),product_names:[name],catalog:[{id:"a",name}]})).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
 });
 it.each([undefined,{...context(),requested_field:undefined},{...context(),expires_at:now.toISOString()},{...context(),product_revision:"bad"}])("CURRENT_FIELD never creates its own authority",ctx=>{
  expect(check("São 5 unidades no total.",{context:ctx,reference:{kind:"CURRENT_FIELD",literal:null}}).status).toBe("NEEDS_INPUT");
 });
 it.each(["Nem 5 unidades de Óleo Aurora para uso interno.","Entraram -5 unidades de Óleo Aurora para uso interno.","Entraram 3 caixas com 5 unidades de Óleo Aurora para uso interno.","Entraram 5 unidades de Óleo Aurora por caixa.","Entraram 5 unidades de Óleo Aurora para cada caixa."])("roles cannot hide original negative, numeric or factor evidence: %s",source=>{
  const reason=source.includes("para uso")?"para uso interno":source.includes("por caixa")?"por caixa":"para cada caixa";
  expect(check(source,{reason,source_scope:source,reference:{kind:"NAMED",literal:"Óleo Aurora"}}).status).toBe("NEEDS_INPUT");
 });
 it.each(["caixa","caixa de papel","unidade","cliente","profissional","litro","mililitro","pacote","hora","2 caixas"])("a known denominator is factual even if labeled cause: %s",dimension=>{
  const reason=`por ${dimension}`,source=`Saíram 5 unidades de Óleo Aurora ${reason}.`;
  expect(check(source,{reason,reference:{kind:"NAMED",literal:"Óleo Aurora"},source_scope:source}).status).toBe("NEEDS_INPUT");
 });
 it.each(["solicitação da equipe","orientação do responsável","necessidade do estabelecimento"])("causal semantics does not require a reason vocabulary: %s",cause=>{
  const reason=`por ${cause}`,source=`Saíram 5 unidades de Óleo Aurora ${reason}.`;
  expect(check(source,{reason}).status).toBe("ACCEPTED");
  expect(check(source,{reason:cause}).status).toBe("NEEDS_INPUT");
 });
 it("a verified product named like a dimension stays an identifier",()=>{
  expect(check("Saíram 5 unidades de Caixa por solicitação da equipe.",{product_names:["Caixa"],reference:{kind:"NAMED",literal:"Caixa"},catalog:[{id:"caixa",name:"Caixa"}],reason:"por solicitação da equipe"})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each([1,2,5,10])("repeated name/count witnesses bind only inside each of %i current action scopes",size=>{
  const parts=Array.from({length:size},(_,index)=>`Registro ${String.fromCharCode(65+index)}: entraram 5 unidades de Óleo Aurora`),source=parts.join("; ")+".";
  const scopes=parts.map((literal,index)=>({key:`s${index}`,operation:"stock.movement",literal}));
  const witnesses=parts.map(source_scope=>({quantity:5,literal:"5 unidades",product_name:"Óleo Aurora",source_scope,reference:{kind:"NAMED" as const,literal:"Óleo Aurora"}}));
  for(let index=0;index<size;index++)expect(check(source,{source_scope:parts[index],reference:{kind:"NAMED",literal:"Óleo Aurora"},operation_scopes:scopes.filter((_,i)=>i!==index),sibling_witnesses:witnesses})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it("a maximal current catalog mention does not conflict with another catalog name inside it",()=>{
  expect(check("São 5 unidades de Shampoo X.",{product_names:["Shampoo X"],context:{...context(),product_ref:"shampoo"},catalog:[{id:"shampoo",name:"Shampoo X"},{id:"x",name:"X"}]})).toMatchObject({status:"ACCEPTED",quantity:5});
 });
 it.each([
  {scope:"5 unidades de Óleo Aurora"},
  {scope:"Entraram 5 unidades de Óleo Aurora.",others:[{key:"a",operation:"financial.report",literal:"Entraram 5 unidades de Óleo Aurora."}]},
  {others:[{key:"a",operation:"financial.report",literal:"e confira o relatório"},{key:"a",operation:"financial.report",literal:"e confira o relatório"}]},
  {scope:"texto do turno anterior"},
 ])("invalid clipped, overlapping or stale scopes never become authority",input=>{
  expect(inventorySourceScopes("Entraram 5 unidades de Óleo Aurora. e confira o relatório",input).valid).toBe(false);
 });
 it("siblings may share their own clause but cannot cut the current inventory proof",()=>{
  const source="Troque uma reserva por outra; entraram 5 unidades de Óleo Aurora.";
  const others=[{key:"cancel",operation:"appointment.cancel",literal:"Troque uma reserva por outra"},{key:"create",operation:"appointment.create",literal:"Troque uma reserva por outra"}];
  expect(inventorySourceScopes(source,{scope:"entraram 5 unidades de Óleo Aurora.",others}).valid).toBe(true);
  expect(inventorySourceScopes(source,{scope:source,others}).valid).toBe(false);
 });
 it("wire reference has only two representable shapes",()=>{
  expect(inventoryReference.safeParse({kind:"NAMED",literal:null}).success).toBe(false);
  expect(inventoryReference.safeParse({kind:"CURRENT_FIELD",literal:"Óleo Aurora"}).success).toBe(false);
 });
});
