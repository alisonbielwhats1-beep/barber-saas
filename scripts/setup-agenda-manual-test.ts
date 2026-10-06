/** Creates one synthetic salon for a manual Secretary Agenda test in the LOCAL disposable DB.
 * Never production: the launcher and assertFreeUseDatabase require 127.0.0.1:55441/everflair_service_mvp.
 * The generated login is written only to .demo/agenda-core/LOCAL-LOGIN.txt (git-ignored), never printed. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { assertFreeUseDatabase } from '../packages/salon-secretary/evaluation/free-use-database';
import { seedFreeUseFixture } from '../packages/salon-secretary/evaluation/free-use-fixture';
import { scenarioFixture, type AgendaScenario } from '../packages/salon-secretary/evaluation/agenda-practice';
import { ensureLocalAppRole } from './setup-local-app-role';

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    await assertFreeUseDatabase(admin, prisma);
    // The full admin UI needs production-parity grants; the MVP runtime role only covers the Secretary.
    const role = await ensureLocalAppRole(process.env.DIRECT_URL ?? '');
    const scenario: AgendaScenario = { id: 'manual', title: 'Teste manual da Agenda', capability: [], steps: [], appointments: [
      { key: 'joao_d1', customer: 'joao', professional: 'ricardo', service: 'corte', day: 1, time: '14:00' },
      { key: 'rosa_d1', customer: 'rosa', professional: 'tatiana', service: 'coloracao', day: 1, time: '10:00' },
      { key: 'amanda_d2', customer: 'amanda', professional: 'tatiana', service: 'escova', day: 2, time: '10:00' },
      { key: 'carla_d4', customer: 'carla', professional: 'tatiana', service: 'escova', day: 4, time: '11:00' },
    ] };
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const identity = await seedFreeUseFixture(admin, 'agenda-manual-' + stamp, 'manual', scenarioFixture(scenario), 'America/Sao_Paulo');
    const email = `agenda.teste.${stamp}@everflair.local`, password = randomBytes(12).toString('base64url');
    await admin.user.update({ where: { id: identity.actor }, data: { email, name: 'Dona do Salão (teste)', passwordHash: await bcrypt.hash(password, 10), passwordSetAt: new Date() } });
    // passwordSetAt is written here by the admin role: the least-privilege local runtime role
    // cannot UPDATE "User", so the app's first-login backfill would otherwise reject the login.
    await admin.salon.update({ where: { id: identity.tenant }, data: { name: 'Everflair — Agenda (teste local)', slug: 'agenda-teste-' + stamp } });
    mkdirSync('.demo/agenda-core', { recursive: true });
    writeFileSync('.demo/agenda-core/LOCAL-LOGIN.txt', [
      'Login LOCAL do teste manual da Secretária (banco descartável 127.0.0.1:55441; não é Production).',
      `E-mail: ${email}`, `Senha: ${password}`, `Salão: Everflair — Agenda (teste local)  |  tenant ${identity.tenant}`,
      'Equipe: Tatiana Rocha (Corte Completo, Escova, Coloração) e Ricardo Alves (Corte Completo, Barba).',
      'Clientes: Amanda Souza, João Pereira, Fábio Santos, Carla Mendes, Rosa Viana.',
      'Agenda inicial: João amanhã 14h (Ricardo); Rosa amanhã 10h–12h (Tatiana, Coloração); Amanda depois de amanhã 10h (Tatiana, Escova); Carla em 4 dias 11h (Tatiana).',
      'Funcionamento: segunda a sábado, 9h–19h.', '',
    ].join('\n'), { mode: 0o600 });
    console.log(JSON.stringify({ status: 'READY', tenant: identity.tenant, login_file: '.demo/agenda-core/LOCAL-LOGIN.txt', app_role: role.role, granted_tables: role.granted.length, inaccessible_tables: role.skipped }));
  } finally { await admin.$disconnect(); await prisma.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ status: 'BLOCKED', code: error instanceof Error ? error.message.slice(0, 200) : 'ERROR' })); process.exitCode = 1; });
