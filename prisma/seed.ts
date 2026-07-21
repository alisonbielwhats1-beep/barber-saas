import { PrismaClient, Role, AppointmentStatus, Plan, Gender } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, setHours, setMinutes, startOfDay } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  // Limpa o banco (dev only)
  await prisma.payment.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.timeOff.deleteMany();
  await prisma.workingHours.deleteMany();
  await prisma.professionalService.deleteMany();
  await prisma.professional.deleteMany();
  await prisma.service.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.salon.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("demo1234", 10);

  // ─── Salão 1: Luna Hair ─────────────────────────────────
  const owner1 = await prisma.user.create({
    data: { email: "dono@lunahair.com", name: "Marina Souza", passwordHash },
  });
  const luna = await prisma.salon.create({
    data: {
      slug: "luna-hair",
      name: "Luna Hair Studio",
      address: "R. Aspicuelta, 522 — Vila Madalena, SP",
      phone: "(11) 3456-7890",
      plan: Plan.PRO,
    },
  });
  await prisma.membership.create({
    data: { userId: owner1.id, salonId: luna.id, role: Role.OWNER },
  });

  const services = await Promise.all([
    prisma.service.create({
      data: { salonId: luna.id, name: "Corte feminino", durationMin: 60, priceCents: 12000, colorHex: "#a13860" },
    }),
    prisma.service.create({
      data: { salonId: luna.id, name: "Coloração completa", durationMin: 180, priceCents: 32000, colorHex: "#c47a5c" },
    }),
    prisma.service.create({
      data: { salonId: luna.id, name: "Escova modelada", durationMin: 45, priceCents: 8000, colorHex: "#8b6b4a" },
    }),
    prisma.service.create({
      data: { salonId: luna.id, name: "Hidratação profunda", durationMin: 60, priceCents: 15000, colorHex: "#4f6b8b" },
    }),
  ]);

  const pros = await Promise.all(
    [
      { email: "camila@lunahair.com", name: "Camila Reis", colorHex: "#a13860", commission: 40 },
      { email: "rafael@lunahair.com", name: "Rafael Ito", colorHex: "#c47a5c", commission: 45 },
    ].map(async (p) => {
      const u = await prisma.user.create({
        data: { email: p.email, name: p.name, passwordHash },
      });
      await prisma.membership.create({
        data: { userId: u.id, salonId: luna.id, role: Role.PROFESSIONAL },
      });
      const pro = await prisma.professional.create({
        data: {
          salonId: luna.id,
          userId: u.id,
          colorHex: p.colorHex,
          commissionPct: p.commission,
        },
      });
      // Vincula todos os serviços
      await prisma.professionalService.createMany({
        data: services.map((s) => ({ professionalId: pro.id, serviceId: s.id })),
      });
      // Horário: seg-sáb, 09:00-19:00
      await prisma.workingHours.createMany({
        data: [1, 2, 3, 4, 5, 6].map((weekday) => ({
          salonId: luna.id,
          professionalId: pro.id,
          weekday,
          startMinutes: 9 * 60,
          endMinutes: 19 * 60,
        })),
      });
      return pro;
    }),
  );

  // Clientes — mix de homens e mulheres (salão atende ambos)
  const clientsData = [
    { name: "Beatriz Lima", phone: "(11) 91234-5678", gender: Gender.FEMALE },
    { name: "Julia Fernandes", phone: "(11) 98765-4321", gender: Gender.FEMALE },
    { name: "Amanda Rocha", phone: "(11) 99999-1111", gender: Gender.FEMALE },
    { name: "Sofia Toledo", phone: "(11) 98888-2222", gender: Gender.FEMALE },
    { name: "Larissa Melo", phone: "(11) 97777-3333", gender: Gender.FEMALE },
    { name: "Pedro Alves", phone: "(11) 96666-4444", gender: Gender.MALE },
    { name: "Lucas Martins", phone: "(11) 95555-5555", gender: Gender.MALE },
    { name: "Gabriel Nogueira", phone: "(11) 94444-6666", gender: Gender.MALE },
  ];
  const clients = await Promise.all(
    clientsData.map((c) =>
      prisma.clientProfile.create({ data: { ...c, salonId: luna.id } }),
    ),
  );

  // Gera agendamentos passados (COMPLETED) + futuros (CONFIRMED) para um salão.
  // Reaproveitada pelos dois tenants.
  async function seedAppointments(
    salonId: string,
    proList: { id: string }[],
    serviceList: { id: string; durationMin: number; priceCents: number }[],
    clientList: { id: string }[],
  ) {
    const today = startOfDay(new Date());
    const bookings: Promise<unknown>[] = [];
    for (let dayOffset = -14; dayOffset <= 7; dayOffset++) {
      const day = addDays(today, dayOffset);
      // 4-6 agendamentos por dia
      const count = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const pro = proList[i % proList.length];
        const service = serviceList[Math.floor(Math.random() * serviceList.length)];
        const client = clientList[Math.floor(Math.random() * clientList.length)];
        const hour = 9 + Math.floor(Math.random() * 9);
        const startAt = setMinutes(setHours(day, hour), Math.random() > 0.5 ? 0 : 30);
        const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

        const status =
          dayOffset < 0 ? AppointmentStatus.COMPLETED : AppointmentStatus.CONFIRMED;

        bookings.push(
          prisma.appointment.create({
            data: {
              salonId,
              clientId: client.id,
              professionalId: pro.id,
              serviceId: service.id,
              startAt,
              endAt,
              priceCents: service.priceCents,
              status,
            },
          }).catch(() => null), // ignora conflitos aleatórios
        );
      }
    }
    await Promise.all(bookings);
  }

  await seedAppointments(luna.id, pros, services, clients);

  // ─── Salão 2: North Barber ──────────────────────────────
  const owner2 = await prisma.user.create({
    data: { email: "dono@northbarber.com", name: "Diego Braga", passwordHash },
  });
  const north = await prisma.salon.create({
    data: {
      slug: "north-barber",
      name: "North Barber Co.",
      address: "R. Fradique Coutinho, 1250 — Pinheiros, SP",
      phone: "(11) 2222-3333",
      plan: Plan.STARTER,
    },
  });
  await prisma.membership.create({
    data: { userId: owner2.id, salonId: north.id, role: Role.OWNER },
  });
  const northServices = await Promise.all([
    prisma.service.create({
      data: { salonId: north.id, name: "Corte social", durationMin: 30, priceCents: 6000, colorHex: "#374151" },
    }),
    prisma.service.create({
      data: { salonId: north.id, name: "Barba desenhada", durationMin: 30, priceCents: 5000, colorHex: "#6b7280" },
    }),
    prisma.service.create({
      data: { salonId: north.id, name: "Combo corte + barba", durationMin: 60, priceCents: 10000, colorHex: "#111827" },
    }),
    prisma.service.create({
      data: { salonId: north.id, name: "Hot towel shave", durationMin: 45, priceCents: 8500, colorHex: "#7c2d12" },
    }),
  ]);

  const northPros = await Promise.all(
    [
      { email: "thiago@northbarber.com", name: "Thiago Nunes", colorHex: "#374151", commission: 50 },
      { email: "bruno@northbarber.com", name: "Bruno Costa", colorHex: "#6b7280", commission: 45 },
      { email: "aline@northbarber.com", name: "Aline Prado", colorHex: "#7c2d12", commission: 45 },
    ].map(async (p) => {
      const u = await prisma.user.create({
        data: { email: p.email, name: p.name, passwordHash },
      });
      await prisma.membership.create({
        data: { userId: u.id, salonId: north.id, role: Role.PROFESSIONAL },
      });
      const pro = await prisma.professional.create({
        data: {
          salonId: north.id,
          userId: u.id,
          colorHex: p.colorHex,
          commissionPct: p.commission,
        },
      });
      await prisma.professionalService.createMany({
        data: northServices.map((s) => ({ professionalId: pro.id, serviceId: s.id })),
      });
      // Horário: ter-sáb, 10:00-20:00
      await prisma.workingHours.createMany({
        data: [2, 3, 4, 5, 6].map((weekday) => ({
          salonId: north.id,
          professionalId: pro.id,
          weekday,
          startMinutes: 10 * 60,
          endMinutes: 20 * 60,
        })),
      });
      return pro;
    }),
  );

  // Clientela da barbearia — maioria homens, com mulheres também
  const northClientsData = [
    { name: "João Pedro Ramos", phone: "(11) 93333-1010", gender: Gender.MALE },
    { name: "Matheus Carvalho", phone: "(11) 93333-2020", gender: Gender.MALE },
    { name: "Felipe Duarte", phone: "(11) 93333-3030", gender: Gender.MALE },
    { name: "André Siqueira", phone: "(11) 93333-4040", gender: Gender.MALE },
    { name: "Vinícius Prado", phone: "(11) 93333-5050", gender: Gender.MALE },
    { name: "Renata Borges", phone: "(11) 93333-6060", gender: Gender.FEMALE },
    { name: "Carla Menezes", phone: "(11) 93333-7070", gender: Gender.FEMALE },
  ];
  const northClients = await Promise.all(
    northClientsData.map((c) =>
      prisma.clientProfile.create({ data: { ...c, salonId: north.id } }),
    ),
  );

  await seedAppointments(north.id, northPros, northServices, northClients);

  // ─── Produtos (Luna Hair) ────────────────────────────────
  const w = (id: string) => `https://images.unsplash.com/${id}?w=600&auto=format&fit=crop&q=80`;
  await prisma.product.createMany({
    data: [
      { salonId: luna.id, name: "Pomada modeladora Matte", brand: "Reuzel", category: "pomade", priceCents: 8900, stock: 12, imageUrl: w("photo-1631730486572-226d1f595b68") },
      { salonId: luna.id, name: "Óleo capilar leave-in", brand: "Kevin Murphy", category: "oleo", priceCents: 14500, stock: 8, imageUrl: w("photo-1620916566398-39f1143ab7be") },
      { salonId: luna.id, name: "Shampoo revitalizante 250ml", brand: "Lunicare", category: "shampoo", priceCents: 6500, stock: 20, imageUrl: w("photo-1608248543803-ba4f8c70ae0b") },
      { salonId: luna.id, name: "Máscara de hidratação profunda", brand: "L'Oréal Pro", category: "tratamento", priceCents: 9800, stock: 6, imageUrl: w("photo-1594736797933-d0501ba2fe65") },
      { salonId: luna.id, name: "Escova térmica premium", brand: "Trimly Tools", category: "acessorio", priceCents: 22000, stock: 3, imageUrl: w("photo-1590540179852-2110a54f813a") },
      { salonId: luna.id, name: "Loção pós-barba", brand: "Proraso", category: "barba", priceCents: 7200, stock: 0, imageUrl: w("photo-1608248597279-f99d160bfcbc") },
    ],
  });
  await prisma.product.createMany({
    data: [
      { salonId: north.id, name: "Pomada Reuzel Grease", brand: "Reuzel", category: "pomade", priceCents: 8900, stock: 15, imageUrl: w("photo-1631730486572-226d1f595b68") },
      { salonId: north.id, name: "Óleo para barba", brand: "Beardbrand", category: "barba", priceCents: 13500, stock: 10, imageUrl: w("photo-1585232004423-244e0e6904e3") },
      { salonId: north.id, name: "Navalha profissional", brand: "Merkur", category: "acessorio", priceCents: 32000, stock: 4, imageUrl: w("photo-1599351431202-1e0f0137899a") },
    ],
  });

  // ─── Portfolio (Luna Hair) ───────────────────────────────
  const captions = [
    "Corte curto com nuca navalhada",
    "Coloração loiro pérola",
    "Long bob liso premium",
    "Balayage caramelo",
    "Undercut clássico",
    "Escova modelada volumosa",
  ];
  const pool = [
    "photo-1622287162716-f311baa1a2b8",
    "photo-1621605815971-fbc98d665033",
    "photo-1560066984-138dadb4c035",
    "photo-1580618672591-eb180b1a973f",
    "photo-1522337660859-02fbefca4702",
    "photo-1503951914875-452162b0f3f1",
  ];
  await prisma.portfolioItem.createMany({
    data: pool.map((id, i) => ({
      salonId: luna.id,
      imageUrl: w(id).replace("w=600", "w=800"),
      caption: captions[i],
      professionalId: pros[i % pros.length].id,
    })),
  });

  // Cliente demo
  await prisma.user.create({
    data: { email: "cliente@demo.com", name: "Cliente Demo", passwordHash },
  });

  // ─── Finanças demo (despesas + pagamentos) ──────────────
  async function seedFinance(sid: string) {
    const fixed = [
      { description: "Aluguel do ponto", category: "Aluguel", amountCents: 320000 },
      { description: "Energia elétrica", category: "Energia", amountCents: 68000 },
      { description: "Internet + telefone", category: "Software", amountCents: 15000 },
      { description: "Assinatura SalonSaaS", category: "Software", amountCents: 19900 },
    ];
    const variable = [
      { description: "Reposição de produtos", category: "Produtos", amountCents: 145000 },
      { description: "Tráfego pago Instagram", category: "Marketing", amountCents: 60000 },
      { description: "Material descartável", category: "Produtos", amountCents: 38000 },
    ];
    const monthStart = startOfDay(new Date());
    monthStart.setDate(3);
    for (const e of fixed) {
      await prisma.expense.create({
        data: { salonId: sid, ...e, kind: "FIXED", recurring: true, method: "PIX", dueDate: monthStart, paidAt: monthStart },
      });
    }
    for (let i = 0; i < variable.length; i++) {
      const paid = i < variable.length - 1;
      await prisma.expense.create({
        data: {
          salonId: sid, ...variable[i], kind: "VARIABLE",
          method: paid ? "PIX" : null,
          dueDate: addDays(new Date(), paid ? -(2 + i * 3) : 4),
          paidAt: paid ? addDays(new Date(), -(2 + i * 3)) : null,
        },
      });
    }
    const methods = ["PIX", "CREDIT_CARD", "DEBIT_CARD", "CASH"] as const;
    const completed = await prisma.appointment.findMany({
      where: { salonId: sid, status: "COMPLETED" },
      select: { id: true, priceCents: true, startAt: true },
    });
    for (const a of completed) {
      await prisma.payment.create({
        data: { appointmentId: a.id, amountCents: a.priceCents, method: methods[Math.floor(Math.random() * methods.length)], paidAt: a.startAt },
      }).catch(() => null);
    }
  }
  await seedFinance(luna.id);
  await seedFinance(north.id);

  console.log("✅ Seed concluído");
  console.log("   → Salão 1: Luna Hair Studio (luna-hair) — dono@lunahair.com");
  console.log("   → Salão 2: North Barber Co. (north-barber) — dono@northbarber.com");
  console.log("   → Senha: demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
