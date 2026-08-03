import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getTenantContext } from "./tenant";

/**
 * Acesso ao banco com contexto de tenant, para uso junto do RLS
 * (`prisma/sql/rls/01_enable_rls.sql`).
 *
 * ⚠️  Nada disso tem efeito enquanto o RLS não estiver aplicado. Até lá estas
 * funções são transações comuns, e o isolamento segue vindo do filtro
 * `salonId` escrito nas queries.
 *
 * ─── POR QUE NÃO É UMA EXTENSÃO DO PRISMA ───────────────────────────────────
 * A versão anterior usava `$extends({ query: { $allOperations } })` e chamava
 * `query(args)` dentro de um `$transaction`. Não funciona: `query()` re-executa
 * a operação no client original, não no `tx`. A GUC era setada numa conexão e a
 * query rodava em outra — que, com RLS ligado, não teria contexto nenhum e
 * devolveria zero linhas em tudo. O sintoma seria um app inteiro vazio, sem
 * nenhum erro.
 *
 * A forma abaixo não tem esse problema porque o chamador recebe o próprio `tx`
 * e roda tudo dentro dele.
 *
 * ─── USO ────────────────────────────────────────────────────────────────────
 *   const servicos = await withTenant((tx) => tx.service.findMany());
 *
 * O `set_config` usa `is_local => true`: o valor morre no fim da transação.
 * Isso é obrigatório com o PgBouncer em transaction mode, onde a conexão é
 * reaproveitada por outra requisição — de outro salão — logo em seguida.
 */

type Tx = Prisma.TransactionClient;

async function setGuc(tx: Tx, key: string, value: string) {
  // `set_config` recebe o valor como parâmetro ligado, então não há
  // interpolação de string na consulta.
  await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
}

/**
 * Executa `fn` com o salão e o usuário da sessão ativos no banco.
 * Use em páginas e Server Actions do painel.
 */
export async function withTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { salonId, userId } = await getTenantContext();
  return prisma.$transaction(async (tx) => {
    await setGuc(tx, "app.current_salon", salonId);
    await setGuc(tx, "app.current_user_id", userId);
    return fn(tx);
  });
}

/**
 * Executa `fn` com um salão explícito, sem depender de sessão.
 *
 * É o caminho das rotas públicas (`/book/*`, `/api/availability`,
 * `/api/appointments`): quem agenda não está logado no salão, e o tenant vem
 * do slug da URL. Resolva slug → id lendo `Salon` (que tem leitura pública nas
 * policies) e passe o id aqui.
 */
export async function withSalon<T>(
  salonId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setGuc(tx, "app.current_salon", salonId);
    return fn(tx);
  });
}

/**
 * Executa `fn` conhecendo apenas o usuário, sem salão ativo.
 *
 * Existe para o passo que descobre o tenant: `getTenantContext()` lê
 * `Membership` para saber a quais salões a pessoa pertence, e essa leitura
 * acontece necessariamente antes de haver salão. Sem isto, a consulta volta
 * vazia sob RLS e todo usuário logado é tratado como se não tivesse salão
 * algum.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setGuc(tx, "app.current_user_id", userId);
    return fn(tx);
  });
}
