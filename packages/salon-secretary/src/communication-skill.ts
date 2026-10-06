import { z } from "zod";
import { entityExtractionInstructions } from "./entity-extraction";
export const communicationInterpretation=z.object({
  recipient_name:z.string().trim().min(2).max(200).describe("Nome completo do destinatário mencionado ou da pessoa referida no cancelamento dependente; não usar fragmentos como serviço.").nullable().optional(),
  channel:z.literal("WHATSAPP").nullable().optional(),
  message_mode:z.enum(["EXACT","GENERATED"]).nullable().optional(),
  content:z.string().min(1).max(2000).nullable().optional(),
}).strict();
export type CommunicationInterpretation=z.infer<typeof communicationInterpretation>;
export function communicationRequirements(){return {operation:"customer.message" as const,required_fields:["recipient","channel","message_mode","content"] as const,default_channel:null,provider:"LOCAL_FAKE",confirmation_required:true};}
export const communicationSkill=`Communication • 1.0.0 • R5 T01/T10/T11/T20; T21 somente cancelamento → mensagem.
${entityExtractionInstructions}
Prepare mensagens individuais para clientes resolvidos pelo backend. Não forneça telefone nem referências.
EXACT preserva o trecho original, sem saudação, correção, emoji ou transformação. GENERATED somente sob solicitação explícita; apresente sugestão completa antes da confirmação.
Canal ausente exige esclarecimento. WHATSAPP neste Gate é exclusivamente simulação local, nunca envio real.
Não alegue cancelamento antes do executor real; ação dependente usa proposta única. Contradições exigem esclarecimento, não execução.
Consulte contexto mínimo e status persistido. Não afirme enviado, entregue ou lido; fake não tem confirmação externa.
Nenhuma campanha, opt-in inventado, template Meta, e-mail, SMS ou mensagem real. A confirmação autenticada ocorre sem modelo.
Preserve campos independentes do draft; pergunte somente requisitos faltantes. Nunca transforme uma resposta sim em execução.`;
