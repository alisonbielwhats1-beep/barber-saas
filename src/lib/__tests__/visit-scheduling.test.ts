import { describe, expect, it } from "vitest";
import {
  findVisitPlan,
  visitBookingSchema,
  visitQuote,
  type VisitDay,
} from "../visit-scheduling";
import { groupVisitItems } from "../visit-plan";
function fixture(): VisitDay {
  const services = [
    {
      id: "hair",
      name: "Cabelo",
      durationMin: 30,
      priceCents: 5000,
      priceType: "FIXED",
      priceNote: null,
      physicalResourceId: null,
      professionals: [
        { professional: { id: "anderson", user: { name: "Anderson" } } },
      ],
    },
    {
      id: "nails",
      name: "Unhas",
      durationMin: 60,
      priceCents: 6000,
      priceType: "FROM",
      priceNote: "Conforme acabamento",
      physicalResourceId: null,
      professionals: [{ professional: { id: "tati", user: { name: "Tati" } } }],
    },
    {
      id: "massage",
      name: "Massagem",
      durationMin: 30,
      priceCents: 7000,
      priceType: "FIXED",
      priceNote: null,
      physicalResourceId: null,
      professionals: [{ professional: { id: "tati", user: { name: "Tati" } } }],
    },
  ];
  return {
    salon: {
      timezone: "America/Sao_Paulo",
      minBookingLeadMinutes: 0,
      maxBookingLeadDays: 60,
      bufferMinutes: 5,
    },
    services,
    priced: services,
    hours: new Map(
      ["anderson", "tati"].map((id) => [
        id,
        [{ startMinutes: 540, endMinutes: 1260 }],
      ]),
    ),
    closures: [],
    blocks: [],
    appointments: [],
    resourceBookings: [],
    offers: [],
    preferences: {
      slotMode: "FIT",
      returnDays: 30,
      serviceReturnDays: {},
      addons: {},
      simultaneousPairs: [],
    },
    date: "2026-10-04",
    now: new Date("2026-10-01T12:00:00Z"),
  } as VisitDay;
}
const choices = [
  { serviceId: "hair" },
  { serviceId: "nails" },
  { serviceId: "massage" },
];
describe("uma visita com profissionais diferentes", () => {
  it("encontra a sequência completa e agrupa serviços consecutivos do mesmo profissional", () => {
    const plan = findVisitPlan(fixture(), choices, 900)!;
    expect(
      plan.items.map((i) => [i.professionalName, i.startLocal.slice(11)]),
    ).toEqual([
      ["Anderson", "15:00"],
      ["Tati", "15:30"],
      ["Tati", "16:30"],
    ]);
    expect(plan.totalCents).toBe(18000);
    expect(groupVisitItems(plan.items).map((g) => g.serviceIds)).toEqual([
      ["hair"],
      ["nails", "massage"],
    ]);
  });
  it("não oferece parte da visita quando a segunda profissional está ocupada", () => {
    const day = fixture();
    day.appointments.push({
      professionalId: "tati",
      startAt: new Date("2026-10-04T18:00:00Z"),
      endAt: new Date("2026-10-04T20:00:00Z"),
    });
    expect(findVisitPlan(day, choices, 900)).toBeNull();
  });
  it("explica o item bloqueado sem enfraquecer a validação", () => {
    const day = fixture();
    const reasons: string[] = [];
    const explicit = [{ serviceId: "hair", professionalId: "anderson" }, { serviceId: "nails", professionalId: "tati" }];
    day.hours.set("tati", [{ startMinutes: 540, endMinutes: 720 }]);
    const onBlocked = (index: number, reason: string) => reasons.push(`${index}:${reason}`);
    expect(findVisitPlan(day, explicit, 900, { manual: true, onBlocked })).toBeNull();
    expect(reasons[0]).toContain("1:"); expect(reasons[0]).toContain("09:00–12:00");
    expect(findVisitPlan(day, explicit, 900, { manual: true, overrideSchedule: true })).not.toBeNull();
    day.appointments.push({ professionalId: "tati", startAt: new Date("2026-10-04T18:00:00Z"), endAt: new Date("2026-10-04T20:00:00Z") });
    reasons.length = 0;
    expect(findVisitPlan(day, explicit, 900, { manual: true, overrideSchedule: true, onBlocked })).toBeNull();
    expect(reasons[0]).toContain("Já existe atendimento");
    day.appointments = [];
    day.closures.push({ startAt: new Date("2026-10-04T18:00:00Z"), endAt: new Date("2026-10-04T23:00:00Z") });
    reasons.length = 0;
    expect(findVisitPlan(day, explicit, 900, { manual: true, overrideSchedule: true, onBlocked })).toBeNull();
    expect(reasons[0]).toContain("salão está fechado");
  });
  it("respeita a preferência e nunca atribui serviço incompatível", () => {
    expect(
      findVisitPlan(
        fixture(),
        [{ serviceId: "nails", professionalId: "anderson" }],
        900,
      ),
    ).toBeNull();
  });
  it("autoriza simultaneidade pública somente por combinação habilitada", () => {
    const day = fixture(),
      parallel = [
        choices[0]!,
        { serviceId: "nails", offsetMin: 0 },
        choices[2]!,
      ];
    expect(findVisitPlan(day, parallel, 900)).toBeNull();
    day.preferences.simultaneousPairs = [["hair", "nails"]];
    const plan = findVisitPlan(day, parallel, 900)!;
    expect(plan.endLocal).toBe("2026-10-04T16:30");
    expect(plan.items[0]!.startLocal).toBe(plan.items[1]!.startLocal);
  });
  it("equipe pode combinar simultâneos mas não sobrepor o mesmo profissional", () => {
    expect(
      findVisitPlan(
        fixture(),
        [{ serviceId: "hair" }, { serviceId: "nails", offsetMin: 0 }],
        900,
        { manual: true },
      ),
    ).not.toBeNull();
    expect(
      findVisitPlan(
        fixture(),
        [{ serviceId: "nails" }, { serviceId: "massage", offsetMin: 0 }],
        900,
        { manual: true },
      ),
    ).toBeNull();
  });
  it("exceção de jornada não ignora fechamento, conflito nem recurso", () => {
    const day = fixture();
    day.hours.clear();
    expect(findVisitPlan(day, choices, 900, { manual: true })).toBeNull();
    expect(
      findVisitPlan(day, choices, 900, {
        manual: true,
        overrideSchedule: true,
      }),
    ).not.toBeNull();
    day.closures.push({
      startAt: new Date("2026-10-04T00:00:00Z"),
      endAt: new Date("2026-10-05T03:00:00Z"),
    });
    expect(
      findVisitPlan(day, choices, 900, {
        manual: true,
        overrideSchedule: true,
      }),
    ).toBeNull();
  });
  it("retém recursos físicos e ofertas da fila", () => {
    const day = fixture();
    day.services[0]!.physicalResourceId = "room";
    day.resourceBookings.push({
      resourceId: "room",
      startAt: new Date("2026-10-04T18:00:00Z"),
      endAt: new Date("2026-10-04T19:00:00Z"),
    });
    expect(findVisitPlan(day, choices, 900)).toBeNull();
    day.resourceBookings = [];
    day.offers.push({
      professionalId: "tati",
      resourceIds: [],
      startAt: new Date("2026-10-04T18:00:00Z"),
      endAt: new Date("2026-10-04T20:00:00Z"),
    });
    expect(findVisitPlan(day, choices, 900)).toBeNull();
  });
  it("limita a janela pública, permite serviços repetidos e rejeita virar o dia", () => {
    expect(
      findVisitPlan(
        fixture(),
        [{ serviceId: "hair" }, { serviceId: "hair" }],
        900,
      )!.items,
    ).toHaveLength(2);
    expect(
      findVisitPlan(fixture(), choices, 1410, {
        manual: true,
        overrideSchedule: true,
      }),
    ).toBeNull();
    const day = fixture();
    day.now = new Date("2026-07-01T00:00:00Z");
    expect(findVisitPlan(day, choices, 900)).toBeNull();
  });
  it("cotação muda com valor, duração e condição a partir de", () => {
    const day = fixture();
    const plan = findVisitPlan(day, choices, 900)!;
    expect(visitQuote({ ...plan, totalCents: plan.totalCents + 1 })).not.toBe(
      visitQuote(plan),
    );
    expect(
      visitQuote({
        ...plan,
        items: plan.items.map((i) => ({ ...i, priceNote: "Nova condição" })),
      }),
    ).not.toBe(visitQuote(plan));
  });
  it("não aceita permissões operacionais no endpoint público", () => {
    expect(
      visitBookingSchema.safeParse({
        salonId: "s",
        date: "2026-10-04",
        choices,
        startLocal: "2026-10-04T15:00",
        idempotencyKey: crypto.randomUUID(),
        quote: "a".repeat(64),
        manual: true,
        scheduleOverrideReason: "Folga",
      }).success,
    ).toBe(false);
  });
  it("aplica intervalo entre reservas, sem separar três serviços contínuos do mesmo profissional", () => {
    const day = fixture();
    day.salon.bufferMinutes = 60;
    const plan = findVisitPlan(
      day,
      Array.from({ length: 3 }, () => ({ serviceId: "hair" })),
      900,
    );
    expect(plan?.items).toHaveLength(3);
    expect(groupVisitItems(plan!.items)).toHaveLength(1);
  });
});
