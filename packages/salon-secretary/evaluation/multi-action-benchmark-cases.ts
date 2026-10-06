/** Explicit benchmark oracle, never part of the provider's input context. */
import { makeFixture, syntheticRef, type SyntheticFixture } from "./hard-conversations-fixtures";
import { intent, plan } from "../../../src/test/secretary-capability-plan";
import { call } from "../../../src/test/scripted-services-model";
import type { ModelResponse } from "../src";

const appointment = (service = true, time = true) => intent("appointment.create", { item_key: "a", customer_name: "Andrinho", day_offset: 1,
  ...(service ? { service_name: "Corte Completo" } : {}), ...(time ? { time: "10:00" } : {}) });
const block = (end = true, key = "b") => intent("schedule.block", { item_key: key, professional_name: "Tatiana", day_offset: 1, time: "14:00", ...(end ? { end_time: "15:00" } : {}) });
const five = (service = true) => [
  intent("appointment.cancel", { item_key: "a", customer_name: "Amanda Souza", day_offset: 1, time: "10:00", reason: "pedido dela" }),
  intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", ...(service ? { service_name: "Corte Completo" } : {}) }),
  intent("customer.message", { item_key: "c", depends_on: ["a"], communication: { recipient_name: "Amanda Souza", channel: "WHATSAPP", message_mode: "EXACT", content: "Seu horário foi cancelado." } }),
  intent("service.change", { item_key: "d", target_name: "Massagem", priceCents: 8000 }),
  intent("financial.report", { item_key: "e", financial: { metrics: ["service_revenue"], period: "yesterday" } }),
];
const ten = (missing = false) => [...five(!missing),
  intent("customer.create", { item_key: "f", name: "Lia Santos" }),
  intent("stock.movement", { item_key: "g", inventory: { product_name: "Shampoo X", mode: "IN", quantity: 10 } }),
  block(!missing, "h"), intent("product.search", { item_key: "i", inventory: { low_stock: true } }),
  intent("service.create", { item_key: "j", name: "Barba Expressa", priceCents: 3500, durationMin: 20 }),
];
const selection = (ops: ReturnType<typeof intent>[]) => ({ ...plan(ops), independent: !ops.some(op => (op as { depends_on?: string[] }).depends_on?.length) });
const fiveMessage = (service = true) => `Cancela Amanda Souza amanhã às 10h por pedido dela, coloca Fábio Santos no lugar${service ? " para Corte Completo" : ""}, avisa Amanda Souza no WhatsApp exatamente "Seu horário foi cancelado.", altera a Massagem para R$80 e me fala quanto faturei ontem.`;
const tenMessage = (missing = false) => `${fiveMessage(!missing)} Também cadastra Lia Santos como cliente, dá entrada em 10 unidades de Shampoo X, bloqueia Tatiana amanhã das 14h${missing ? "" : " às 15h"}, mostra os produtos com estoque baixo e cadastra Barba Expressa por R$35 com duração de 20 minutos.`;
export type BenchmarkCase = { id: string; actions: number; primary: boolean; fixture: "free" | "amanda_target" | "many_cuts";
  messages: string[]; outputs: ModelResponse["output"][]; expected: ReturnType<typeof selection>;
  missing: Record<string, string[]>; final: "PROPOSAL" | "AMBIGUOUS" | "CONFLICT"; overlap?: boolean };
export const benchmarkCases: BenchmarkCase[] = [
  { id: "x40", actions: 1, primary: true, fixture: "free", messages: ["Agenda o Andrinho amanhã às 10h para Corte Completo."], outputs: [], expected: selection([appointment()]), missing: {}, final: "PROPOSAL" },
  { id: "x41", actions: 1, primary: false, fixture: "free", messages: ["Marca um Corte Completo pro Andrinho amanhã.", "10h."], outputs: [call("upsert_action_draft", { operation: "appointment.create", time: "10:00" })], expected: selection([appointment(true, false)]), missing: { a: ["time"] }, final: "PROPOSAL" },
  { id: "x42", actions: 1, primary: false, fixture: "many_cuts", messages: ["Marca um corte pro Andrinho amanhã.", "10h."], outputs: [call("upsert_action_draft", { operation: "appointment.create", time: "10:00" })], expected: selection([intent("appointment.create", { item_key: "a", customer_name: "Andrinho", day_offset: 1, service_name: "corte" })]), missing: { a: ["service_ref"] }, final: "AMBIGUOUS" },
  { id: "x43", actions: 2, primary: true, fixture: "free", messages: ["Agenda o Andrinho amanhã às 10h para Corte Completo e bloqueia a Tatiana amanhã das 14h às 15h."], outputs: [], expected: selection([appointment(), block()]), missing: {}, final: "PROPOSAL" },
  { id: "x44", actions: 2, primary: false, fixture: "free", messages: ["Agenda o Andrinho amanhã e bloqueia a Tatiana amanhã das 14h às 15h.", "Corte Completo às 10h."], outputs: [call("upsert_action_draft", { operation: "appointment.create", service_name: "Corte Completo", time: "10:00" })], expected: selection([appointment(false, false), block()]), missing: { a: ["service_name", "time"] }, final: "PROPOSAL" },
  { id: "x45", actions: 5, primary: true, fixture: "amanda_target", messages: [fiveMessage()], outputs: [], expected: selection(five()), missing: {}, final: "PROPOSAL" },
  { id: "x46", actions: 5, primary: false, fixture: "amanda_target", messages: [fiveMessage(false), "Corte Completo."], outputs: [call("upsert_action_draft", { item_key: "b", service_name: "Corte Completo" })], expected: selection(five(false)), missing: { b: ["service_name"] }, final: "PROPOSAL" },
  { id: "x47", actions: 5, primary: false, fixture: "amanda_target", messages: [fiveMessage()], outputs: [], expected: selection(five()), missing: {}, final: "CONFLICT", overlap: true },
  { id: "x48", actions: 10, primary: true, fixture: "amanda_target", messages: [tenMessage()], outputs: [], expected: selection(ten()), missing: {}, final: "PROPOSAL" },
  { id: "x49", actions: 10, primary: false, fixture: "amanda_target", messages: [tenMessage(true), "Corte Completo para o Fábio e bloqueia até 16h."], outputs: [call("select_capabilities", selection([
    intent("appointment.create", { item_key: "b", service_name: "Corte Completo" }), intent("schedule.block", { item_key: "h", end_time: "16:00" }),
  ]))], expected: selection(ten(true)), missing: { b: ["service_name"], h: ["end_time"] }, final: "PROPOSAL" },
];
export const benchmarkTurnCount = benchmarkCases.reduce((sum, item) => sum + item.messages.length, 0);
/** Distinct namespaces for controlled validation and real measurements, no resets. */
export function benchmarkFixture(c: BenchmarkCase, phase: "a" | "b"): SyntheticFixture {
  const id = `x${Number(c.id.slice(1)) + (phase === "a" ? 20 : 0)}`;
  const f = makeFixture(id, c.fixture);
  f.customers.push({ id: syntheticRef(id, "customer:Andrinho"), tenant: f.tenant, name: "Andrinho", revision: 1, contactEligible: false });
  if (c.overlap) {
    const child = f.services.find(s => s.name === "Corte Infantil")!, professional = f.professionals.find(p => p.name === "Tatiana")!;
    // The baseline itself is valid: Amanda occupies 30 minutes. Replacing it with
    // the requested 45-minute Corte Completo would overlap the following booking.
    f.appointments[0].serviceId = child.id;
    f.appointments[0].endAt = "2026-10-06T10:30:00-03:00";
    f.appointments.push({ id: syntheticRef(id, "overlap-next"), tenant: f.tenant, customerId: f.customers.find(x => x.name === "Alisson")!.id,
      professionalId: professional.id, serviceId: child.id, startAt: "2026-10-06T10:30:00-03:00", endAt: "2026-10-06T11:00:00-03:00", status: "CONFIRMED", revision: 1 });
  }
  return f;
}
