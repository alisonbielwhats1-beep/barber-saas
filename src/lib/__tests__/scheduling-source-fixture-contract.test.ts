import {it,expect} from "vitest";
import {groundSchedulingReasons,pendingSourceFields} from "../scheduling-literal-source";
// These synthetic utterances predate source provenance. Their scripted models
// invented the given reason. Originals and file hashes are archived in
// .demo/reason-fixture-provenance; positive tests now supply the literal cause.
it.each([
 ["batch","Cancele Amanda e coloque Fábio nesse horário","Substituição solicitada"],
 ["scheduling","Pedido sintético do cenário","Pedido da cliente"],
 ["communication","Cancele Fábio e mande no WhatsApp: “Serviço cancelado, Fábio.”","Substituição solicitada pela equipe"],
 ["execution default","Prepare as ações informadas para minha revisão.","Pedido da cliente"],
 ["execution fanout","Cancele Amanda e coloque Fábio. Envie exatamente “Cancelado.”","Pedido da cliente"],
])("old synthetic %s cannot invent a cause",(_name,source,reason)=>{
 const patch={reason};const result=groundSchedulingReasons(patch,{},source);
 expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field:"reason",value:reason}]);expect(patch).toEqual({});expect(pendingSourceFields(undefined,result)).toEqual(["reason"]);
});

it("case-only model representation keeps the exact source cause",()=>{
 const patch:Record<string,unknown>={reason:"Pedido da cliente"};const result=groundSchedulingReasons(patch,{},"Cancele Amanda a pedido da cliente e coloque Fábio.");
 expect(result.rejected).toEqual([]);expect(patch.reason).toBe("pedido da cliente");expect(patch.reason_source).toMatchObject({original_text:"pedido da cliente",interpreted_text:"Pedido da cliente"});
});
