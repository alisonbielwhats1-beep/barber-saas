/**
 * Preenche ClientProfile.gender para clientes existentes que nunca tiveram
 * o campo definido manualmente, usando inferGenderFromName() (heurística
 * por primeiro nome). Nunca sobrescreve um gênero já preenchido.
 *
 * Por padrão roda em modo leitura (mostra o que faria). Só grava com --apply.
 *
 * Bloqueado contra produção por assertSafeDatabaseOperation — mesma regra
 * usada em scripts/seed-martinelli.ts. Rodar contra produção é um fluxo
 * separado e deliberadamente manual, fora deste script.
 *
 * Executar: npx tsx scripts/backfill-client-gender.ts [--apply]
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { assertSafeDatabaseOperation } from "../src/lib/database-safety";
import { inferGenderFromName } from "../src/lib/name-gender";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
assertSafeDatabaseOperation(process.env, {
  operation: "backfill-client-gender",
});

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

async function main() {
  const clients = await prisma.clientProfile.findMany({
    where: { gender: null },
    select: { id: true, name: true, salonId: true },
  });

  const matched = clients
    .map((c) => ({ ...c, inferred: inferGenderFromName(c.name) }))
    .filter((c): c is typeof c & { inferred: "MALE" | "FEMALE" } => c.inferred !== null);
  const unmatched = clients.length - matched.length;

  console.log(
    `${apply ? "🔵 Aplicando" : "🟡 Simulando (use --apply para gravar)"}: ` +
      `${matched.length} de ${clients.length} clientes sem gênero têm nome reconhecido.`,
  );

  if (!apply) {
    for (const c of matched.slice(0, 20)) {
      console.log(`  ${c.name} → ${c.inferred}`);
    }
    if (matched.length > 20) console.log(`  ... e mais ${matched.length - 20}`);
    console.log(`${unmatched} clientes ficam sem gênero (nome não reconhecido pela lista).`);
    return;
  }

  let updated = 0;
  for (const c of matched) {
    await prisma.clientProfile.update({
      where: { id: c.id },
      data: { gender: c.inferred },
    });
    updated++;
  }
  console.log(`✅ ${updated} clientes atualizados. ${unmatched} seguem sem gênero (nome não reconhecido).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
