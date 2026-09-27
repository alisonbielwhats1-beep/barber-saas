import { z } from "zod";

// Shared by published transport and the backend validator. No defaults,
// normalization, inferred values or domain permissions belong to this shape.
const literal=z.string().min(1).max(600).regex(/^\S(?:[\s\S]*\S)?$/);
export const temporalNegativeContextProof=z.object({negative_context:z.array(z.union([
  z.object({role:z.literal("OVERRIDE_CONSENT"),literal,
    anchor:z.object({field:z.literal("override_requested"),value:z.literal(false),literal}).strict()}).strict(),
  z.object({role:z.literal("PRIOR_CALENDAR_CONDITION"),literal,
    anchor:z.object({field:z.enum(["date","source_date"]),literal}).strict()}).strict(),
])).min(1).max(2)}).strict();
export type TemporalNegativeContextProof=z.infer<typeof temporalNegativeContextProof>;

/** Open extraction guidance, deliberately separate from closed domain manuals. */
export const temporalNegativeContextInstructions=`Distingua negar a própria operação de negar uma exceção dentro de um pedido positivo. Não selecione nem prepare uma operação recusada. Preserve somente outras intenções efetivamente solicitadas; sem pedido operacional, use o modo de conversa sem operações.
temporal_negative_context é prova transitória da mensagem atual, nunca campo do ERP. Use null salvo em appointment.create com pedido positivo e contexto negativo de um dos papéis publicados. Não use essa prova para transformar recusa de agendar em pedido de agendamento.
OVERRIDE_CONSENT identifica exclusivamente recusa de sobreposição/encaixe: override_requested=false. Copie em literal a oração negativa completa, e em anchor.literal a dimensão exata sobreposição ou encaixe; anchor.field=override_requested e anchor.value=false. Isso não concede exceção, permissão ou confirmação.
PRIOR_CALENDAR_CONDITION identifica condição negativa sobre a data já aceita no draft atual. A âncora literal é a referência de calendário anterior; anchor.field identifica date/source_date já publicado. O novo destino exige data explícita diferente e sua própria prova temporal positiva. Não invente binding, draft, revisão ou contexto ausente.
Cada literal e âncora deve ser um trecho atual exato, inteiro e único, mantendo acentos, caixa e negação. Não recorte palavra, qualificador, entidade ou instrução; não inclua a prova positiva atual na prova negativa. Uma prova por papel negativo, até duas disjuntas. Papel incerto, outra recusa ou falta de contexto: não forje prova nem valor. A classificação semântica é sua; backend verifica fatos e pode pedir esclarecimento.`;
