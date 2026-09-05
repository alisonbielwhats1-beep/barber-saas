import { notFound } from "next/navigation";
import { AgendaBoard, type Appointment } from "../(admin)/agenda/agenda-board";

// Temporary local capture harness. Remove before delivery/build.
export default async function Capture({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { theme } = await searchParams;
  const appointments: Appointment[] = [
    ["09:00", "10:00", "p1", "Corte e finalização", "CONFIRMED"],
    ["09:30", "10:30", "p2", "Tratamento capilar", "CONFIRMED"],
    ["11:00", "11:45", "p1", "Corte", "PENDING"],
    ["11:00", "12:00", "p2", "Hidratação", "CONFIRMED"],
    ["13:00", "14:00", "p1", "Corte e finalização", "CONFIRMED"],
    ["08:30", "09:30", "p3", "Atendimento", "CONFIRMED"],
    ["10:00", "11:00", "p4", "Atendimento", "PENDING"],
    ["09:00", "10:00", "p5", "Atendimento", "CONFIRMED"],
  ].map(([start, end, professionalId, serviceName, status], index) => ({
    id: `example-${index}`, professionalId, startAt: `2026-09-08T${start}:00-03:00`, endAt: `2026-09-08T${end}:00-03:00`,
    priceCents: 8000, status, notes: null, clientName: `Cliente exemplo ${index + 1}`, clientPhone: null, serviceName,
    serviceColor: "#2ECC8B", waitlistCount: 0, waitlistNext: null, waitlist: [], isOverbooked: false,
    version: 1, serviceIds: [], hasPayment: false, pendingReschedule: null, events: [],
  }));
  const professionals = ["A", "B", "C", "D", "E"].map((name, index) => ({ id: `p${index + 1}`, name: `Profissional ${name}`, colorHex: ["#bfa7de", "#6db9be", "#e3bc91", "#98c9ad", "#dea9b6"][index], serviceIds: [] }));
  return <main id="main-content" data-theme={theme === "light" ? "admin-light" : undefined} style={{ width: 1200, height: 820, overflow: "hidden", padding: 28, background: "hsl(var(--background))" }}><AgendaBoard date="2026-09-08" salonName="Estúdio demonstração" timezone="America/Sao_Paulo" professionals={professionals} appointments={appointments} services={[]} clients={[]} canCreate={false} canOverbook={false} canCancel={false} /></main>;
}
