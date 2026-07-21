/**
 * Migração Studio Martinelli
 * Cria o salão, vincula Andreson Martinelli (já existe no banco) como dono,
 * cria Tatiana Medeiros e o catálogo completo de serviços.
 *
 * Executar: npx tsx scripts/seed-martinelli.ts
 */

import { PrismaClient, Role, Plan, Gender } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🔵 Iniciando migração Studio Martinelli...");

  // Abort se já existir
  const existing = await prisma.salon.findUnique({ where: { slug: "studio-martinelli" } });
  if (existing) {
    console.log("⚠️  Salão studio-martinelli já existe. Abortando.");
    return;
  }

  const passwordHash = await bcrypt.hash("trocar-agora", 10);

  // ── Salão ─────────────────────────────────────────────────────────────────
  const salon = await prisma.salon.create({
    data: {
      slug: "studio-martinelli",
      name: "Studio Martinelli",
      address: "Rua Nestor Gomes 44, A C2, 05271-090, São Paulo",
      phone: "(11) 99999-0000",
      plan: Plan.PRO,
      openMinutes: 9 * 60,
      closeMinutes: 18 * 60,
      cancelPolicyHours: 2,
    },
  });
  console.log(`✅ Salão criado: ${salon.name}`);

  // ── Dono: Andreson Martinelli (já existe como usuário) ────────────────────
  let ownerUser = await prisma.user.findUnique({
    where: { email: "andersonmartinelli@hotmail.com" },
    include: { professional: true },
  });

  if (!ownerUser) {
    ownerUser = await prisma.user.create({
      data: { email: "andersonmartinelli@hotmail.com", name: "Andreson Martinelli", passwordHash },
      include: { professional: true },
    }) as typeof ownerUser;
    console.log("✅ Usuário Andreson criado");
  } else {
    console.log("ℹ️  Usuário Andreson já existe, reutilizando");
  }

  // Adiciona membership de OWNER no novo salão
  await prisma.membership.upsert({
    where: { userId_salonId: { userId: ownerUser!.id, salonId: salon.id } },
    create: { userId: ownerUser!.id, salonId: salon.id, role: Role.OWNER },
    update: { role: Role.OWNER },
  });

  // Professional: move o registro existente ou cria novo
  let proAndreson: { id: string };
  if (ownerUser!.professional) {
    // Limpa dados do salão anterior e move para Martinelli
    const oldProfId = ownerUser!.professional.id;
    await prisma.workingHours.deleteMany({ where: { professionalId: oldProfId } });
    await prisma.professionalService.deleteMany({ where: { professionalId: oldProfId } });
    proAndreson = await prisma.professional.update({
      where: { id: oldProfId },
      data: {
        salonId: salon.id,
        colorHex: "#1A1A2E",
        commissionPct: 100,
        monthlyGoalCents: 1200000,
        bio: "Dono e cabeleireiro especialista em cortes masculinos e femininos",
        active: true,
      },
    });
    console.log("✅ Professional Andreson movido para Studio Martinelli");
  } else {
    proAndreson = await prisma.professional.create({
      data: {
        salonId: salon.id,
        userId: ownerUser!.id,
        colorHex: "#1A1A2E",
        commissionPct: 100,
        monthlyGoalCents: 1200000,
        bio: "Dono e cabeleireiro especialista em cortes masculinos e femininos",
      },
    });
    console.log("✅ Professional Andreson criado");
  }

  await prisma.workingHours.createMany({
    data: [2, 3, 4, 5, 6].map((weekday) => ({
      salonId: salon.id,
      professionalId: proAndreson.id,
      weekday,
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    })),
  });

  // ── Profissional: Tatiana Medeiros ─────────────────────────────────────────
  let tatianaUser = await prisma.user.findUnique({ where: { email: "tatiana@studiomartinelli.com" } });
  if (!tatianaUser) {
    tatianaUser = await prisma.user.create({
      data: { email: "tatiana@studiomartinelli.com", name: "Tatiana Medeiros", passwordHash },
    });
    console.log("✅ Usuária Tatiana criada");
  }

  await prisma.membership.upsert({
    where: { userId_salonId: { userId: tatianaUser.id, salonId: salon.id } },
    create: { userId: tatianaUser.id, salonId: salon.id, role: Role.PROFESSIONAL },
    update: { role: Role.PROFESSIONAL },
  });

  // Tatiana pode já ter Professional em outro salão
  let proTatiana: { id: string };
  const tatianaExisting = await prisma.professional.findUnique({ where: { userId: tatianaUser.id } });
  if (tatianaExisting) {
    await prisma.workingHours.deleteMany({ where: { professionalId: tatianaExisting.id } });
    await prisma.professionalService.deleteMany({ where: { professionalId: tatianaExisting.id } });
    proTatiana = await prisma.professional.update({
      where: { id: tatianaExisting.id },
      data: { salonId: salon.id, colorHex: "#8B1A4A", commissionPct: 50, monthlyGoalCents: 600000, bio: "Especialista em depilação, unhas, maquiagem e cuidados com a pele", active: true },
    });
    console.log("✅ Professional Tatiana movida para Studio Martinelli");
  } else {
    proTatiana = await prisma.professional.create({
      data: {
        salonId: salon.id,
        userId: tatianaUser.id,
        colorHex: "#8B1A4A",
        commissionPct: 50,
        monthlyGoalCents: 600000,
        bio: "Especialista em depilação, unhas, maquiagem e cuidados com a pele",
      },
    });
    console.log("✅ Professional Tatiana criada");
  }

  await prisma.workingHours.createMany({
    data: [2, 3, 4, 5, 6].map((weekday) => ({
      salonId: salon.id,
      professionalId: proTatiana.id,
      weekday,
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    })),
  });

  // ── Serviços ───────────────────────────────────────────────────────────────
  type SvcDef = [string, number, number, string, "A" | "T"];

  const serviceDefs: SvcDef[] = [
    // ── ANDRESON: CORTE MASCULINO ──────────────────────────────────────────
    ["Corte de cabelo masculino", 45, 5500, "Corte Masculino", "A"],
    ["Pezinho", 10, 1500, "Corte Masculino", "A"],
    ["Penteados masculino", 25, 2500, "Corte Masculino", "A"],
    ["Desenho", 30, 2500, "Corte Masculino", "A"],
    ["Hidratação em cabelo masculino", 15, 2000, "Corte Masculino", "A"],

    // ── ANDRESON: BARBA ────────────────────────────────────────────────────
    ["Barba", 30, 4500, "Barba", "A"],
    ["Barba Terapia", 45, 6500, "Barba", "A"],

    // ── ANDRESON: SOBRANCELHA ─────────────────────────────────────────────
    ["Design de sobrancelha", 40, 5000, "Sobrancelha", "A"],
    ["Designer de sobrancelha com henna", 45, 5500, "Sobrancelha", "A"],
    ["Limpeza de sobrancelha", 30, 4500, "Sobrancelha", "A"],
    ["Sobrancelha na navalha", 20, 2500, "Sobrancelha", "A"],

    // ── ANDRESON: QUÍMICA MASCULINA ───────────────────────────────────────
    ["Progressiva em cabelo masculino", 60, 8000, "Química Masculina", "A"],
    ["Botox em cabelo masculino", 60, 7000, "Química Masculina", "A"],
    ["Coloração em cabelo masculino", 60, 5000, "Química Masculina", "A"],
    ["Descoloração global ou platinado masculino", 120, 15000, "Química Masculina", "A"],
    ["Luzes em cabelo masculino", 90, 8000, "Química Masculina", "A"],

    // ── ANDRESON: COMBO MASCULINO ─────────────────────────────────────────
    ["Corte Masculino + Sobrancelha na Navalha", 60, 7000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + sobrancelha na navalha", 90, 9500, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + hidratação", 85, 10000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + penteado", 90, 10000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + sobrancelha + penteado", 105, 12000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + progressiva + penteado", 105, 12000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + botox + sobrancelha na navalha", 90, 12000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + sobrancelha, Pinça", 100, 12000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + barba + hidratação + penteado", 90, 12000, "Combo Masculino", "A"],
    ["Combo Masc: Corte + botox + barba + sobrancelha", 140, 17000, "Combo Masculino", "A"],

    // ── ANDRESON: CORTE FEMININO ──────────────────────────────────────────
    ["Corte de cabelo feminino", 60, 7000, "Corte Feminino", "A"],

    // ── ANDRESON: ESCOVA E PRANCHA ────────────────────────────────────────
    ["Escova em cabelo curto feminino", 50, 6000, "Escova e Prancha", "A"],
    ["Escova em cabelo médio feminino", 50, 7000, "Escova e Prancha", "A"],
    ["Escova em cabelo longo feminino", 60, 8000, "Escova e Prancha", "A"],

    // ── ANDRESON: QUÍMICA FEMININA ────────────────────────────────────────
    ["Coloração com o produto do salão, cabelo feminino", 105, 18000, "Química Feminina", "A"],
    ["Coloração com produtos da cliente", 105, 10000, "Química Feminina", "A"],
    ["Tratamentos Joico", 80, 15000, "Química Feminina", "A"],
    ["Reconstrução em cabelo feminino", 80, 13000, "Química Feminina", "A"],
    ["Nutrição em cabelo feminino", 80, 12000, "Química Feminina", "A"],
    ["Progressiva com formol", 195, 22000, "Química Feminina", "A"],
    ["Botox em cabelo feminino", 195, 20000, "Química Feminina", "A"],
    ["Detok em cabelo feminino", 180, 18000, "Química Feminina", "A"],

    // ── ANDRESON: COMBO FEMININO ──────────────────────────────────────────
    ["Combo Fem: Corte + escova e prancha", 90, 12000, "Combo Feminino", "A"],
    ["Combo Fem: Corte + limpeza de sobrancelha + escova", 105, 16000, "Combo Feminino", "A"],
    ["Combo Fem: Coloração + escova e prancha", 150, 20000, "Combo Feminino", "A"],
    ["Combo Fem: Coloração + escova + henna", 180, 22000, "Combo Feminino", "A"],
    ["Combo Fem: Hidratação + escova + henna", 105, 16000, "Combo Feminino", "A"],
    ["Combo Fem: Hidratação + escova + sobrancelha", 105, 15000, "Combo Feminino", "A"],
    ["Combo Fem: Corte + hidratação + escova", 120, 16000, "Combo Feminino", "A"],
    ["Combo Fem: Progressiva + corte + sobrancelha", 240, 30000, "Combo Feminino", "A"],
    ["Combo Fem: Botox + corte + sobrancelha", 210, 28000, "Combo Feminino", "A"],
    ["Combo Fem: Coloração + Corte + Sobrancelha", 195, 29500, "Combo Feminino", "A"],

    // ── TATIANA: DEPILAÇÃO ────────────────────────────────────────────────
    ["Buço", 15, 2000, "Depilação", "T"],
    ["Nariz", 30, 2000, "Depilação", "T"],
    ["Orelha", 30, 2000, "Depilação", "T"],
    ["Axila", 30, 3000, "Depilação", "T"],
    ["Pé e dedos (depilação)", 30, 1500, "Depilação", "T"],
    ["Buço + Nariz", 40, 4000, "Depilação", "T"],
    ["Orelha + Nariz", 40, 4000, "Depilação", "T"],
    ["Rosto", 30, 3500, "Depilação", "T"],
    ["Barba (depilação)", 60, 4500, "Depilação", "T"],
    ["Virilha simples", 30, 4000, "Depilação", "T"],
    ["Virilha cavada", 45, 5000, "Depilação", "T"],
    ["Íntimo completo", 60, 8000, "Depilação", "T"],
    ["Íntimo completo com ânus", 90, 9000, "Depilação", "T"],
    ["Meia perna", 60, 6000, "Depilação", "T"],
    ["Perna completa", 80, 10000, "Depilação", "T"],
    ["Peito com abdômen", 120, 7500, "Depilação", "T"],
    ["Costas", 60, 7500, "Depilação", "T"],

    // ── TATIANA: MAQUIAGEM ────────────────────────────────────────────────
    ["Maquiagem Tradicional", 90, 13000, "Maquiagem", "T"],

    // ── TATIANA: UNHAS ────────────────────────────────────────────────────
    ["Mão simples", 75, 3500, "Unhas", "T"],
    ["Pé", 90, 4000, "Unhas", "T"],
    ["Pé e Mão", 150, 7000, "Unhas", "T"],
    ["Esmaltação", 30, 2000, "Unhas", "T"],
    ["Blindagem nas unhas naturais", 120, 8000, "Unhas", "T"],
    ["Banho de gel", 150, 10000, "Unhas", "T"],
    ["Banho de gel na mão + Pé", 180, 14000, "Unhas", "T"],
    ["Alongamento em gel na tips", 180, 13000, "Unhas", "T"],
    ["Alongamento Mold F1", 180, 13000, "Unhas", "T"],
    ["Manutenção de Alongamento", 180, 11000, "Unhas", "T"],
    ["Reposição de alongamento (cada unha)", 30, 1500, "Unhas", "T"],
    ["Remoção de alongamento", 90, 5000, "Unhas", "T"],
    ["Pé com esmaltação em gel", 120, 7000, "Unhas", "T"],
    ["Mão com esmaltação em gel", 120, 7000, "Unhas", "T"],
    ["Pé e Mão + esmaltação em gel na mão", 180, 10000, "Unhas", "T"],
    ["Pé e Mão + esmaltação em gel no pé", 165, 10000, "Unhas", "T"],
    ["Pé e Mão + esmaltação em gel nos dois", 180, 12000, "Unhas", "T"],
    ["Pé e Mão + Spar dos Pés com Parafina", 195, 11500, "Unhas", "T"],
    ["Combo: pé + spar dos pés", 150, 8000, "Unhas", "T"],

    // ── TATIANA: CUIDADOS COM A PELE ─────────────────────────────────────
    ["Limpeza de pele", 120, 12000, "Cuidados com a Pele", "T"],
    ["Spar dos pés com parafina", 90, 5000, "Cuidados com a Pele", "T"],
    ["Plástica dos pés", 120, 8000, "Cuidados com a Pele", "T"],
    ["Spar das mãos com parafina", 30, 2500, "Cuidados com a Pele", "T"],
    ["Escalda Pés com esfoliação + massagem", 60, 4000, "Cuidados com a Pele", "T"],
  ];

  console.log(`\n📋 Criando ${serviceDefs.length} serviços...`);

  const andersonServiceIds: string[] = [];
  const tatianaServiceIds: string[] = [];

  for (const [name, durationMin, priceCents, category, pro] of serviceDefs) {
    const svc = await prisma.service.create({
      data: { salonId: salon.id, name, durationMin, priceCents, category, active: true },
    });
    if (pro === "A") andersonServiceIds.push(svc.id);
    else tatianaServiceIds.push(svc.id);
  }

  await prisma.professionalService.createMany({
    data: andersonServiceIds.map((id) => ({ professionalId: proAndreson.id, serviceId: id })),
  });
  await prisma.professionalService.createMany({
    data: tatianaServiceIds.map((id) => ({ professionalId: proTatiana.id, serviceId: id })),
  });

  console.log(`✅ ${andersonServiceIds.length} serviços → Andreson`);
  console.log(`✅ ${tatianaServiceIds.length} serviços → Tatiana`);

  // ── Clientes iniciais ──────────────────────────────────────────────────────
  await prisma.clientProfile.createMany({
    data: [
      { salonId: salon.id, name: "Ana Clara Souza", phone: "(11) 98000-0001", gender: Gender.FEMALE },
      { salonId: salon.id, name: "Fernanda Lima", phone: "(11) 98000-0002", gender: Gender.FEMALE },
      { salonId: salon.id, name: "Juliana Costa", phone: "(11) 98000-0003", gender: Gender.FEMALE },
      { salonId: salon.id, name: "Ricardo Pereira", phone: "(11) 98000-0004", gender: Gender.MALE },
      { salonId: salon.id, name: "Carlos Eduardo", phone: "(11) 98000-0005", gender: Gender.MALE },
      { salonId: salon.id, name: "Paulo Henrique", phone: "(11) 98000-0006", gender: Gender.MALE },
    ],
  });
  console.log("✅ 6 clientes iniciais criados");

  console.log("\n══════════════════════════════════════════════════════");
  console.log("🎉 Studio Martinelli migrado com sucesso!");
  console.log("══════════════════════════════════════════════════════");
  console.log("   Login do dono:  andersonmartinelli@hotmail.com");
  console.log("   Senha inicial:  trocar-agora  (alterar em Configurações)");
  console.log("   Booking:        /book/studio-martinelli");
  console.log("══════════════════════════════════════════════════════");
}

main()
  .catch((e) => { console.error("❌ Erro:", e.message ?? e); process.exit(1); })
  .finally(() => prisma.$disconnect());
