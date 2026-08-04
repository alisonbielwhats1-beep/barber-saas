import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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
 *   const ctx = await getTenantContext();
 *   const servicos = await withTenant(ctx, (tx) => tx.service.findMany());
 *
 * `withTenant` recebe o contexto já resolvido em vez de chamar
 * `getTenantContext()` internamente, por dois motivos:
 *
 *   1. Import circular: `getTenantContext()` (`tenant.ts`) precisa de
 *      `withUser` daqui para a PRÓPRIA leitura de `Membership` (ver abaixo).
 *      Se este arquivo importasse `tenant.ts` de volta, os dois módulos se
 *      importariam um ao outro — frágil sob o bundler do Next.js, que pode
 *      deixar um dos dois parcialmente inicializado.
 *   2. Toda Server Action já chama `getTenantContext()` para checar o papel
 *      via `assertRole()` antes de tocar no banco. Se `withTenant` chamasse
 *      de novo, seria uma segunda consulta a `Membership` por escrita — em
 *      dobro, sem necessidade.
 *
 * O `set_config` usa `is_local => true`: o valor morre no fim da transação.
 * Isso é obrigatório com o PgBouncer em transaction mode, onde a conexão é
 * reaproveitada por outra requisição — de outro salão — logo em seguida.
 */

/**
 * Exportado para os helpers de `lib/` (kpis.ts, finance.ts, dashboard.ts…)
 * tipar o parâmetro `tx` que recebem do chamador, em vez de importar
 * `prisma` cru internamente — é essa troca de assinatura que permite migrar
 * um helper de BI sem duplicar sua lógica.
 */
export type Tx = Prisma.TransactionClient;

async function setGuc(tx: Tx, key: string, value: string) {
  // `set_config` recebe o valor como parâmetro ligado, então não há
  // interpolação de string na consulta.
  await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
}

/**
 * Seta a GUC de salão numa transação já aberta pelo próprio chamador.
 *
 * Existe para o único caso em que nem `withTenant` nem `withSalon` servem:
 * `signup` e `onboarding/create-salon` criam o `Salon` DENTRO da transação —
 * não há `salonId` pra passar a `withSalon` antes de abrir, porque o salão
 * ainda não existe. Depois do INSERT do Salon (que não precisa de GUC — a
 * policy de INSERT é aberta, `WITH CHECK (TRUE)`), chame isto com o id
 * recém-criado antes de qualquer INSERT em Membership ou Service — as
 * policies deles exigem `salonId = app_current_salon()`, inclusive na
 * escrita.
 */
export async function setSalonGuc(tx: Tx, salonId: string): Promise<void> {
  await setGuc(tx, "app.current_salon", salonId);
}

/**
 * Executa `fn` com o salão e o usuário de um contexto já resolvido
 * (`getTenantContext()`). Use em páginas e Server Actions do painel.
 */
export async function withTenant<T>(
  ctx: { salonId: string; userId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setGuc(tx, "app.current_salon", ctx.salonId);
    await setGuc(tx, "app.current_user_id", ctx.userId);
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

/**
 * Resolve um salão pelo slug da URL e executa `fn` já com a GUC setada.
 * Devolve `null` sem chamar `fn` se o slug não existir.
 *
 * É o padrão das páginas de `/book/[salonSlug]`: a página não sabe o
 * `salonId` até ler o `Salon` pelo slug, mas as relações aninhadas do select
 * (Service, Professional, PortfolioItem, Product…) são tabelas com RLS
 * exigindo a GUC do salão — sem ela, a leitura do `Salon` funciona (policy
 * pública), mas cada relação aninhada volta vazia, silenciosamente, porque a
 * policy dela compara `salonId` com uma GUC nunca setada.
 *
 * Por isso o id é resolvido ANTES de abrir a transação, com uma consulta à
 * parte — `Salon` tem leitura pública (`USING (TRUE)`), então essa consulta
 * não precisa de GUC nenhuma. Isso custa um round-trip extra por carregamento
 * de página pública; é o preço de não poder saber o salão antes de achar o
 * salão.
 */
export async function withSalonBySlug<T>(
  slug: string,
  fn: (tx: Tx, salonId: string) => Promise<T>,
): Promise<T | null> {
  const found = await prisma.salon.findUnique({ where: { slug }, select: { id: true } });
  if (!found) return null;
  return withSalon(found.id, (tx) => fn(tx, found.id));
}
