"use client";

import { useState, type CSSProperties } from "react";
import { CalendarDays, Users, Wallet, Package, Bell, Search, ChevronLeft, ChevronRight, Plus, Sun, Moon, Monitor, Smartphone, SlidersHorizontal } from "lucide-react";
import type { MarketingSegmentId } from "./segments";
import "./agenda-devices.css";
import { OperationWalkthrough } from "./operation-walkthrough";
import { BrandMark } from "@/components/brand";

const professionals = [
  { name: "Ana Martins", initials: "AM" },
  { name: "Rafael Costa", initials: "RC" },
  { name: "Camila Lima", initials: "CL" },
  { name: "Lucas Rocha", initials: "LR" },
];
const appointments = [
  { name: "Mariana Souza", service: "Corte e finalização", professional: 0, time: "09:00", minute: 0, duration: 60, tone: "lilac", confirmed: true },
  { name: "Gabriel Santos", service: "Corte e barba", professional: 1, time: "09:30", minute: 30, duration: 60, tone: "blue", confirmed: true },
  { name: "Fernanda Ribeiro", service: "Limpeza de pele", professional: 2, time: "09:00", minute: 0, duration: 60, tone: "peach", confirmed: true },
  { name: "Bruno Ferreira", service: "Massagem relaxante", professional: 3, time: "09:30", minute: 30, duration: 60, tone: "lilac", confirmed: false },
  { name: "Juliana Oliveira", service: "Hidratação", professional: 0, time: "10:30", minute: 90, duration: 60, tone: "peach", confirmed: false },
  { name: "Pedro Almeida", service: "Corte masculino", professional: 1, time: "11:00", minute: 120, duration: 60, tone: "lilac", confirmed: true },
  { name: "Carolina Mendes", service: "Manicure", professional: 2, time: "10:30", minute: 90, duration: 60, tone: "blue", confirmed: true },
  { name: "Larissa Melo", service: "Atendimento facial", professional: 3, time: "11:30", minute: 150, duration: 60, tone: "peach", confirmed: true },
];

function DayGrid({ mobile = false, professional = 0, step = 0 }: { mobile?: boolean; professional?: number; step?: number }) {
  const visibleProfessionals = mobile ? [professionals[professional]] : professionals;
  return <div className="ad-day-grid" style={{ "--ad-columns": visibleProfessionals.length } as CSSProperties}>
    <div className="ad-professionals"><span />{visibleProfessionals.map(pro => <div key={pro.name}><i>{pro.initials}</i><span>{mobile ? pro.name.split(" ")[0] : pro.name}</span></div>)}</div>
    <div className="ad-timeline"><div className="ad-hours">{["09:00", "10:00", "11:00", "12:00"].map(hour => <span key={hour}>{hour}</span>)}</div>
      <div className="ad-columns">{visibleProfessionals.map((pro, index) => <div className="ad-column" key={pro.name}>{appointments.filter(item => item.professional === (mobile ? professional : index)).map(item => <div className="ad-appointment" data-tone={item.tone} data-guided={item.name === "Mariana Souza"} key={item.name} style={{ top: `${item.minute / 240 * 100}%`, height: `${item.duration / 240 * 100}%` }}><strong>{item.name}</strong><span>{item.service}</span><small>{item.time} · {item.duration} min</small><em>{item.name === "Mariana Souza" && step > 0 ? "Concluído" : item.confirmed ? "Confirmado" : "A confirmar"}</em></div>)}</div>)}</div>
      <div className="ad-now"><span />Agora · 10:15</div>
    </div>
  </div>;
}

function DesktopAgenda({ step }: { step: number }) {
  return <div className="ad-desktop" aria-hidden="true"><div className="ad-desktop-bezel"><div className="ad-camera" /><div className="ad-desktop-screen">
    <aside className="ad-sidebar"><span className="ad-logo"><BrandMark /></span>{[CalendarDays, Users, Wallet, Package, Bell].map((Icon, index) => <span className={index === 0 ? "ad-nav-active" : ""} key={index}><Icon /></span>)}<i>AM</i></aside>
    <div className="ad-workspace"><div className="ad-desktop-heading"><div><span>SEU ESPAÇO, ORGANIZADO</span><h3>Agenda</h3></div><div className="ad-date"><ChevronLeft />8 de setembro, terça-feira<ChevronRight /></div><span className="ad-new"><Plus />Novo</span></div>
      <div className="ad-kpis">{[["8", "Agendamentos"], [step > 0 ? "1" : "0", "Concluídos"], [step > 1 ? "R$ 80,00" : "R$ 0,00", "Recebido"], [step > 0 ? "R$ 80,00" : "R$ 0,00", "Realizado"]].map(([value, label]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="ad-toolbar"><span><Search />Buscar cliente</span><span>Todos os profissionais</span><div><b>Dia</b><span>Semana</span><span>Mês</span><span>Lista</span></div></div>
      <div className="ad-statuses"><span>Todos os status</span><span>● Confirmado</span><span>● A confirmar</span></div>
      <DayGrid step={step} />
      <div className="ad-desktop-footer"><span>4 profissionais · 8 atendimentos</span><span>Dados de demonstração</span></div>
    </div>
  </div></div><div className="ad-laptop-base"><span /></div></div>;
}

function MobileAgenda({ step }: { step: number }) {
  const [professional, setProfessional] = useState(0);
  return <div className="ad-mobile" role="group" aria-label="Demonstração da agenda no celular"><div className="ad-phone-speaker" aria-hidden="true" /><div className="ad-phone-screen"><div className="ad-phone-status" aria-hidden="true"><span>09:41</span><span>••• ▰</span></div>
    <div className="ad-mobile-heading"><div><span>TERÇA, 8 DE SETEMBRO</span><h3>Sua agenda.</h3></div><Bell /></div>
    <div className="ad-week">{["D 6", "S 7", "T 8", "Q 9", "Q 10", "S 11", "S 12"].map((day, i) => <span data-selected={i === 2} key={day}><small>{day.split(" ")[0]}</small><b>{day.split(" ")[1]}</b></span>)}</div>
    <label className="ad-mobile-filter"><span><SlidersHorizontal aria-hidden="true" />Profissional</span><select value={professional} onChange={event => setProfessional(Number(event.target.value))} aria-label="Profissional na demonstração da agenda">{professionals.map((pro, index) => <option key={pro.name} value={index}>{pro.name}</option>)}</select></label>
    <div aria-hidden="true"><DayGrid mobile professional={professional} step={step} /></div>
    <p className="sr-only" aria-live="polite">{professionals[professional].name}: {appointments.filter(item => item.professional === professional).map(item => `${item.name}, ${item.service}, ${item.time}, ${item.duration} minutos, ${item.name === "Mariana Souza" && step > 0 ? "concluído" : item.confirmed ? "confirmado" : "a confirmar"}`).join(". ")}.</p>
    <div className="ad-mobile-nav" aria-hidden="true">{[{ Icon: CalendarDays, label: "Agenda" }, { Icon: Users, label: "Clientes" }, { Icon: Wallet, label: "Financeiro" }].map(({ Icon, label }) => <span key={label}><Icon />{label}</span>)}</div>
  </div><div className="ad-home-indicator" /></div>;
}

export function AgendaDevices({ segmentId }: { segmentId: MarketingSegmentId }) {
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<{ segmentId: MarketingSegmentId; theme: "light" | "dark" } | null>(null);
  const theme = choice?.segmentId === segmentId ? choice.theme : segmentId === "barbearia" ? "dark" : "light";
  return <div className="ad-showcase" data-agenda-theme={theme}>
    <div className="ad-showcase-toolbar"><span><Monitor />No computador.<Smartphone />Com você.</span><div className="ad-theme-controls" role="group" aria-label="Tema da prévia da agenda">{[{ theme: "light" as const, label: "Claro", Icon: Sun }, { theme: "dark" as const, label: "Escuro", Icon: Moon }].map(item => <button type="button" key={item.theme} aria-pressed={theme === item.theme} onClick={() => setChoice({ segmentId, theme: item.theme })}><item.Icon size={15} />{item.label}</button>)}</div></div>
    <OperationWalkthrough step={step} onStep={setStep} /><figure className="ad-figure"><div className="ad-device-stage"><div className="ad-stage-glow" /><DesktopAgenda step={step} /><MobileAgenda step={step} /></div><figcaption>A agenda acompanha a demonstração. Alterne o tema e explore os profissionais.<small>Prévia ilustrativa baseada na agenda do sistema. Nomes, atendimentos e valores fictícios.</small></figcaption></figure>
  </div>;
}
