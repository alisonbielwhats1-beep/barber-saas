"use server";
import { revalidatePath } from "next/cache";
import { getTenantContext, assertRole } from "@/lib/tenant";
import { assertSecretaryEnvironment, salonSecretary } from "@/lib/salon-secretary-runtime";
import type { SecretaryView } from "@/lib/salon-secretary";
import { assertSecretaryRolloutAccess } from "@/lib/secretary-rollout";

async function context() {
  assertSecretaryEnvironment();
  const ctx = await getTenantContext();
  assertRole(ctx, ["OWNER", "MANAGER", "RECEPTIONIST"]);
  assertSecretaryRolloutAccess(ctx);
  return { salonId: ctx.salonId, userId: ctx.userId };
}
export type SecretaryReply = { ok: true; state: SecretaryView } | { ok: false; error: string; code?: string };
type Reply = SecretaryReply;
async function safely(fn: () => Promise<SecretaryView>): Promise<Reply> {
  try { return { ok: true, state: await fn() }; }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    // Stable diagnostic codes only: exception text may contain database/provider secrets.
    console.error("SECRETARY_OPERATION_REJECTED", /^[A-Z][A-Z0-9_]{1,79}$/.test(code) ? code : "UNCLASSIFIED_ERROR");
    const messages: Record<string, string> = {
      SECRETARY_NOT_AVAILABLE: "A Secretária não está habilitada para este acesso.",
      FORBIDDEN: "Seu acesso não permite esta ação. O plano foi preservado para revisão.",
      CONFIRMATION_STALE: "Esta proposta foi substituída. Revise a versão atual antes de confirmar.",
      REVISION_CONFLICT: "Esta proposta mudou. Prepare e confirme uma nova versão.",
      EXPIRED: "A proposta expirou. Prepare uma nova versão antes de confirmar.",
      PLAN_NOT_READY: "Há informações ou conflitos a revisar antes de confirmar.",
      CONFIRMATION_GROUP_REQUIRED: "Revise e confirme o grupo completo de ações.",
      SESSION_CLOSED: "Esta conversa foi encerrada. Inicie uma nova conversa.",
      ENTITY_MENTION_CONFLICT: "Não foi possível separar com segurança o cliente e o serviço. Informe o nome completo do cliente e, somente se necessário, o serviço em separado. Nenhuma ação foi executada.",
      CONTACT_NOT_ELIGIBLE: "O cliente não possui contato válido para esse canal.",
      RECIPIENT_CHANGED: "O contato mudou. Prepare uma nova proposta antes de confirmar.",
      MESSAGE_CONTENT_REVIEW_REQUIRED: "Informe o texto exato entre aspas ou solicite explicitamente uma sugestão.",
      UNSUPPORTED_COMMUNICATION_DEPENDENCY: "Essa combinação precisa ser esclarecida. Somente cancelamento seguido de mensagem ao mesmo cliente é suportado.",
      DEPENDENCY_RECIPIENT_MISMATCH: "O destinatário deve corresponder ao cliente do cancelamento.",
      COMMUNICATION_LOCAL_ONLY: "Comunicação disponível somente no teste local, sem envio externo.",
      PRODUCT_NOT_FOUND: "Não encontrei esse produto neste salão.",
      PRODUCT_CHANGED: "O produto ou saldo mudou após o rascunho. Nenhuma movimentação foi aplicada. Inicie uma nova conversa para revisar o saldo atual.",
      STOCK_OVERFLOW: "O saldo projetado ultrapassa o limite permitido.",
      "Estoque insuficiente para esta saida": "Estoque insuficiente para esta saída. Nenhuma movimentação foi aplicada.",
      FINANCIAL_READ_ONLY: "Esta consulta financeira é somente leitura e não possui confirmação de escrita.",
      RECEIVABLE_IS_CURRENT_BALANCE: "A receber é o saldo atual de todas as datas. Consulte sem período ou comparação histórica.",
      FINANCIAL_GROUP_UNSUPPORTED: "O ranking disponível é por faturamento de serviços, sem comparação entre períodos. Reformule a consulta.",
      FINANCIAL_RANGE_EXCEEDED: "O valor ultrapassa o limite seguro desta consulta. Nenhum valor estimado foi apresentado.",
      SLOT_CONFLICT: "O horário ficou indisponível. Escolha outro horário e prepare nova proposta.",
      SLOT_TAKEN: "O horário ficou indisponível. Nada foi agendado.",
      SCHEDULE_CHANGED: "Os dados do agendamento mudaram. Prepare uma nova proposta.",
      REASON_REQUIRED: "Informe o motivo real do cancelamento, com pelo menos três caracteres.",
      ALREADY_STARTED_OR_CLOSED: "Esse agendamento já começou ou foi encerrado. Nenhuma alteração foi feita.",
      SCHEDULING_RELATION_NOT_SUPPORTED: "Este agendamento possui produtos ou dependente. Use a agenda para revisar essas relações; a Secretária ainda não as altera.",
      APPOINTMENT_SEARCH_TOO_BROAD: "Muitos agendamentos encontrados. Informe a data e o horário original.",
      PAST_TIME: "Informe um novo horário futuro.",
      PRO_SERVICE_MISMATCH: "O profissional não realiza esse serviço.",
      AMBIGUOUS_DATE: "Informe uma única data inequívoca.",
      INVALID_LOCAL_DATE: "Informe uma data válida.",
      PAID_CALLS_DISABLED: "Chamadas pagas bloqueadas. Aguarde a autorização e configuração do teste real.",
      SECRETARY_CONFIGURATION_REQUIRED: "Configure modelo, chave exclusiva e projeto aprovado no servidor.",
      SECRETARY_TURN_FAILED: "Não foi possível concluir este turno. Nenhum cadastro foi executado. O rascunho válido foi preservado.",
      SESSION_NOT_FOUND: "Sessão indisponível ou expirada. Inicie uma nova conversa.",
      PLAN_NOT_IN_SESSION: "Este pedido não pertence à conversa atual.",
      SUSPENDED_PLAN_LIMIT: "Há cinco pedidos guardados. Retome um deles ou inicie uma nova conversa.",
      SESSION_BUSY: "Há uma operação em andamento. Aguarde antes de tentar novamente.",
      PROPOSAL_MISMATCH: "Proposta inválida, cancelada ou desatualizada. Prepare uma nova proposta.",
      CUSTOMER_CHANGED: "O cadastro mudou após a proposta. Inicie uma nova conversa para revisar os dados.",
      DUPLICATE_CANDIDATE: "Existe cadastro correspondente. Revise antes de continuar.",
      SERVICE_CHANGED: "O serviço mudou após a proposta. Nada foi alterado. Inicie uma nova conversa para revisar o estado atual.",
      SELECTION_INVALID: "Seleção inválida ou desatualizada. Localize o serviço novamente.",
    };
    return { ok: false, code: Object.hasOwn(messages, code) ? code : "BACKEND_FAILURE", error: messages[code] ?? "Operação recusada. Verifique acesso, configuração e validade da proposta." };
  }
}
export async function startSecretary() { return safely(async () => salonSecretary.start(await context(), "auto")); }
export async function sendSecretary(input: unknown) { return safely(async () => salonSecretary.send(await context(), input)); }
export async function selectSecretaryService(sessionId: string, serviceRef: string) {
  return safely(async () => salonSecretary.selectService(await context(), sessionId, serviceRef));
}
export async function confirmSecretary(sessionId: string, input: unknown) {
  return safely(async () => {
    const result = await salonSecretary.confirm(await context(), sessionId, input);
    return refreshConfirmedState(result);
  });
}
export async function cancelSecretary(sessionId: string) { return safely(async () => salonSecretary.cancel(await context(), sessionId)); }

export async function selectSecretaryCustomer(sessionId: string, customerRef: string) { return safely(async () => salonSecretary.selectCustomer(await context(), sessionId, customerRef)); }

export async function selectSecretaryOperation(sessionId: string, operationRef: string, ref: string) {
  return safely(async()=>salonSecretary.selectAutomatic(await context(),sessionId,operationRef,ref));
}
export async function confirmSecretaryOperation(sessionId: string, operationRef: string, input: unknown) {
  return safely(async()=>{
    const state=await salonSecretary.confirmAutomatic(await context(),sessionId,operationRef,input);
    return refreshConfirmedState(state);
  });
}
export async function cancelSecretaryOperation(sessionId: string, operationRef: string) {
  return safely(async()=>salonSecretary.cancelAutomaticOperation(await context(),sessionId,operationRef));
}

/** Transport only: the validated coordinator remains the sole group authority. */
export async function confirmSecretaryGroup(sessionId: string, input: unknown) {
  return safely(async () => {
    const state = await salonSecretary.confirmActionPlanGroup(await context(), sessionId, input);
    return refreshConfirmedState(state);
  });
}

async function refreshConfirmedState(state: SecretaryView) {
  const views = [state, ...(state.operations?.map(operation => operation.state) ?? [])];
  if (!views.some(view => view.receipt || view.customer?.receipt || view.scheduling?.receipt || view.inventory?.receipt || view.batch?.receipt || view.communication?.receipt)) return state;
  try {
    for (const route of ["/servicos", "/produtos", "/clientes", "/agenda", "/financeiro", "/hoje", "/notificacoes"]) revalidatePath(route);
    revalidatePath("/book/[salonSlug]", "layout");
  } catch { return { ...state, execution_warnings: [...(state.execution_warnings ?? []), "VIEW_REFRESH_UNAVAILABLE"] }; }
  return state;
}

export async function resumeSecretaryPlan(sessionId: string, planRef: string): Promise<Reply> {
  return safely(async () => salonSecretary.resumePlan(await context(), sessionId, planRef));
}
