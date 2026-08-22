"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Grid2X2,
  Home,
  Search,
  ShoppingBag,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CLIENT_SCREENS = ["Início", "Agendar", "Reservas", "Avisos"] as const;

export function LandingMobileShowcase() {
  const [screen, setScreen] = useState(0);
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setScreen((value) => (value + 1) % CLIENT_SCREENS.length), 4_500);
    return () => window.clearInterval(timer);
  }, [paused]);

  useEffect(() => () => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
  }, []);

  function chooseScreen(index: number) {
    setScreen(index);
    setPaused(true);
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => setPaused(false), 8_000);
  }

  return (
    <section className="landing-section bg-white">
      <div className="container">
        <div className="mx-auto max-w-3xl text-center">
          <p className="landing-eyebrow">Uma experiência conectada</p>
          <h2 className="mt-4 font-display text-3xl leading-tight tracking-[-.04em] sm:text-5xl">O cliente agenda. O estabelecimento acompanha.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">Duas experiências conectadas à mesma agenda, reproduzidas a partir das telas reais do produto.</p>
        </div>

        <div className="mt-14 grid gap-6 xl:grid-cols-2">
          <article className="grid min-h-[720px] overflow-hidden rounded-[2rem] border border-[#cfe7df] bg-[#e8f8f5] px-6 pt-10 shadow-[0_32px_70px_-56px_rgba(23,32,28,.55)] sm:grid-cols-[.8fr_1.2fr] sm:px-10 sm:pt-12">
            <div className="relative z-10 pb-8 sm:pt-8">
              <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#178b65]">Para o cliente</p>
              <h3 className="mt-3 font-display text-3xl tracking-[-.04em]">Veja o aplicativo funcionando</h3>
              <p className="mt-4 text-sm leading-relaxed text-[#4f5d58]">Uma experiência completa para o cliente descobrir, agendar e acompanhar seus horários.</p>
              <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Telas demonstradas">
                {CLIENT_SCREENS.map((label, index) => <button key={label} type="button" aria-pressed={screen === index} onClick={() => chooseScreen(index)} className={cn("min-h-11 rounded-full border px-3 text-[11px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#178b65] focus-visible:ring-offset-2", screen === index ? "border-[#178b65] bg-[#178b65] text-white" : "border-[#a8cec0] bg-white/70 text-[#284f41] hover:border-[#178b65]/60")}>{label}</button>)}
              </div>
            </div>
            <ClientPhone screen={screen} onPause={setPaused} />
          </article>

          <article className="grid min-h-[720px] overflow-hidden rounded-[2rem] border border-[#dfe1dd] bg-[#f0f1ef] px-6 pt-10 shadow-[0_32px_70px_-56px_rgba(23,32,28,.55)] sm:grid-cols-[.72fr_1.28fr] sm:px-9 sm:pt-12">
            <div className="relative z-10 pb-8 sm:pt-8">
              <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[#178b65]">Para o estabelecimento</p>
              <h3 className="mt-3 font-display text-3xl tracking-[-.04em]">A agenda do dia no bolso</h3>
              <p className="mt-4 text-sm leading-relaxed text-[#4f5d58]">Indicadores, filtros, profissionais, horários e status no mesmo formato usado pelo estabelecimento.</p>
            </div>
            <OwnerPhone />
          </article>
        </div>
      </div>
    </section>
  );
}

function PhoneShell({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div aria-hidden="true" className={cn("relative mx-auto h-[640px] w-[306px] self-end rounded-t-[3rem] border p-2.5 shadow-[0_30px_70px_-28px_rgba(7,12,10,.45)]", dark ? "border-[#303138] bg-[#111216]" : "border-[#252932] bg-[#090b0f]")}><span className={cn("absolute left-1/2 top-4 z-30 h-6 w-24 -translate-x-1/2 rounded-full", dark ? "bg-[#22242a]" : "bg-[#1b1f27]")} /><div className="relative h-full overflow-hidden rounded-t-[2.35rem] bg-[#0e0f12]">{children}</div></div>;
}

function ClientPhone({ screen, onPause }: { screen: number; onPause: (paused: boolean) => void }) {
  return (
    <div onMouseEnter={() => onPause(true)} onMouseLeave={() => onPause(false)} className="self-end">
      <PhoneShell dark>
        {[<ClientHome key="home" />, <ClientBooking key="booking" />, <ClientReservations key="reservations" />, <ClientAlerts key="alerts" />].map((content, index) => <div key={index} aria-hidden={screen !== index} inert={screen !== index ? true : undefined} className={cn("absolute inset-x-0 bottom-[62px] top-0 overflow-hidden transition-opacity duration-300", screen === index ? "z-10 opacity-100" : "pointer-events-none opacity-0")}>{content}</div>)}
        <ClientNav active={screen} />
      </PhoneShell>
    </div>
  );
}

function ClientHome() {
  return <div className="h-full bg-[#0e0f12] px-3 pt-10 text-[#f8f5ef]">
    <div className="flex items-center gap-2 px-1"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#7df89b]/15 text-[9px] font-extrabold text-[#7df89b]">EA</span><div className="min-w-0 flex-1"><small className="block text-[7px] uppercase tracking-wider text-[#8f9099]">Bem-vindo a</small><b className="block truncate text-[10px]">Espaço Aurora</b></div><span className="relative grid h-7 w-7 place-items-center rounded-full border border-[#2a2c32]"><ShoppingBag className="h-3.5 w-3.5" /><i className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#7df89b] text-[7px] not-italic text-black">2</i></span><span className="grid h-7 w-7 place-items-center rounded-full border border-[#2a2c32]"><Bell className="h-3.5 w-3.5" /></span></div>
    <div className="relative mt-4 h-[145px] overflow-hidden rounded-[1.4rem]"><Image src="/images/salon-hero-stylist-v2.webp" alt="Espaço Aurora, estabelecimento demonstrativo" fill quality={85} sizes="280px" className="object-cover object-center" /><div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" /><div className="absolute bottom-3 left-3"><span className="rounded-full bg-[#7df89b] px-2 py-1 text-[7px] font-bold text-black">MULTISSERVIÇOS</span><strong className="mt-1.5 block text-base">Espaço Aurora</strong><small className="text-[7px] text-white/75">Jardins · São Paulo</small></div></div>
    <div className="mt-3 rounded-[1.3rem] bg-[#7df89b] p-3.5 text-[#0c130f]"><strong className="text-sm">Agendar um horário</strong><p className="my-1 text-[8px] opacity-70">Escolha o serviço e veja os horários disponíveis agora.</p><span className="inline-flex rounded-full bg-[#111418] px-3 py-2 text-[8px] font-bold text-[#7df89b]">Agendar agora ↗</span></div>
    <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-[#292b31] bg-[#191a1f] p-2.5 text-[7px] text-[#a6a7ae]"><span className="flex gap-1"><Clock3 className="h-3 w-3 text-[#7df89b]" />Aberto até 19:00</span><span>Cancelamento com 2h</span></div>
    <div className="mt-3 flex items-center justify-between px-1 text-[8px]"><b>Nossa equipe</b><span className="text-[#7df89b]">Ver todos ›</span></div>
    <div className="mt-2 flex gap-2">{[["CM", "Camila", "Cabelo e cor"], ["BR", "Bruna", "Unhas e estética"]].map((person) => <div key={person[0]} className="flex-1 rounded-xl border border-[#292b31] bg-[#191a1f] p-2 text-center"><b className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-[#7df89b]/20 text-[8px] text-[#7df89b]">{person[0]}</b><small className="mt-1 block text-[8px]">{person[1]}</small><span className="block text-[6px] text-[#8f9099]">{person[2]}</span></div>)}</div>
    <div className="mt-2.5 flex items-center gap-2 rounded-full border border-[#292b31] bg-[#191a1f] px-3 py-2 text-[8px] text-[#8f9099]"><Search className="h-3 w-3" />Buscar serviços...</div>
  </div>;
}

function FlowHeader({ title }: { title: string }) { return <div className="flex items-center gap-3 px-4 pb-4 pt-12 text-white"><span className="grid h-7 w-7 place-items-center rounded-full border border-[#2b2d33]">‹</span><div><small className="block text-[7px] text-[#8f9099]">Espaço Aurora</small><b className="text-[12px]">{title}</b></div></div>; }

function ClientBooking() { return <div className="h-full bg-[#0e0f12] text-white"><FlowHeader title="Escolha os serviços" /><div className="mx-3 rounded-xl border border-[#7df89b]/40 bg-[#7df89b]/5 p-3"><b className="block text-[9px] text-[#7df89b]">1 serviço escolhido</b><small className="text-[7px] text-[#8f9099]">Corte + tratamento</small></div><div className="mx-3 mt-3 flex items-center gap-2 rounded-full border border-[#292b31] bg-[#191a1f] px-3 py-2 text-[8px] text-[#8f9099]"><Search className="h-3 w-3" />Buscar corte, unha, massagem...</div><div className="mx-3 mt-2 flex gap-1.5 text-[7px]"><b className="rounded-full bg-[#7df89b] px-2.5 py-1.5 text-black">Todos</b><span className="rounded-full border border-[#292b31] px-2.5 py-1.5">Cabelo</span><span className="rounded-full border border-[#292b31] px-2.5 py-1.5">Unhas</span></div><div className="mx-3 mt-3 grid grid-cols-2 gap-2">{[["Corte feminino", "50 min", "R$ 80"], ["Escova", "40 min", "R$ 55"], ["Manicure", "45 min", "R$ 45"], ["Massagem", "60 min", "R$ 120"]].map((service, index) => <article key={service[0]} className={cn("min-h-[105px] rounded-xl border bg-[#191a1f] p-2.5", index === 0 ? "border-[#7df89b]" : "border-[#292b31]")}><i className={cn("ml-auto grid h-4 w-4 place-items-center rounded-full border text-[8px] not-italic", index === 0 ? "border-[#7df89b] bg-[#7df89b] text-black" : "border-[#34363d]")}>{index === 0 ? "✓" : ""}</i><b className="mt-2 block text-[9px] leading-tight">{service[0]}</b><small className="mt-1 block text-[7px] text-[#8f9099]">{service[1]}</small><strong className="mt-2 block text-[9px] text-[#7df89b]">{service[2]}</strong></article>)}</div><div className="absolute inset-x-3 bottom-3 rounded-full bg-[#7df89b] py-3 text-center text-[9px] font-bold text-black">Continuar · R$ 80</div></div>; }

function ClientReservations() { return <div className="h-full bg-[#0e0f12] text-white"><FlowHeader title="Minhas reservas" /><div className="mx-4 flex gap-4 border-b border-[#292b31] text-[8px]"><b className="border-b-2 border-[#7df89b] pb-2 text-[#7df89b]">Próximas</b><span>Histórico</span></div><article className="mx-3 mt-5 grid grid-cols-[48px_1fr] gap-3 rounded-2xl border border-[#292b31] bg-[#191a1f] p-3"><div className="rounded-xl bg-[#7df89b]/10 p-2 text-center"><b className="block text-lg text-[#7df89b]">18</b><small className="text-[7px]">AGO</small></div><div><span className="rounded-full bg-[#7df89b]/15 px-2 py-1 text-[7px] text-[#7df89b]">Confirmado</span><h4 className="mt-2 text-[10px]">Corte + hidratação</h4><p className="mt-1 text-[8px] text-[#b8b9be]">14:30 · Camila Mendes</p><small className="text-[7px] text-[#74767f]">Espaço Aurora · Jardins</small></div></article><div className="mx-3 flex justify-end gap-2 border-x border-b border-[#292b31] px-3 py-2 text-[8px]"><span>Ver detalhes</span><b className="text-[#7df89b]">Remarcar</b></div><div className="mx-3 mt-5 rounded-2xl border border-[#292b31] p-4 text-center"><b className="text-[10px]">Tudo organizado</b><p className="mt-2 text-[8px] leading-relaxed text-[#8f9099]">Acompanhe horário, profissional e situação do atendimento em um só lugar.</p></div></div>; }

function ClientAlerts() { return <div className="h-full bg-[#0e0f12] text-white"><FlowHeader title="Notificações" /><div className="space-y-2 px-3">{[["Agendamento confirmado", "Seu horário de 18 de agosto, às 14:30, foi confirmado.", "Agora"], ["Lembrete do seu horário", "Amanhã você tem atendimento com Camila.", "Há 2 horas"], ["Conte como foi", "Seu atendimento foi concluído. Esperamos ver você novamente.", "12 de agosto"]].map((alert, index) => <article key={alert[0]} className={cn("flex gap-2.5 rounded-xl border p-3", index === 0 ? "border-[#7df89b]/40 bg-[#7df89b]/5" : "border-[#292b31] bg-[#191a1f]")}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#7df89b]/15 text-[10px] text-[#7df89b]">{index === 1 ? "↻" : index === 2 ? "★" : "✓"}</span><div><b className="text-[9px]">{alert[0]}</b><p className="my-1 text-[8px] leading-relaxed text-[#a3a4ab]">{alert[1]}</p><small className="text-[7px] text-[#666870]">{alert[2]}</small></div></article>)}</div></div>; }

function ClientNav({ active }: { active: number }) { const items = [{ icon: Home, label: "Início", index: 0 }, { icon: ShoppingBag, label: "Loja", index: -1 }, { icon: CalendarDays, label: "Agendar", index: 1 }, { icon: CalendarDays, label: "Reservas", index: 2 }, { icon: Bell, label: "Notificações", index: 3 }]; return <div className="absolute inset-x-0 bottom-0 z-20 grid h-[62px] grid-cols-5 border-t border-[#2a2b31] bg-[#191a1f] px-1 text-[#8f9099]">{items.map((item) => <span key={item.label} className={cn("grid place-content-center justify-items-center gap-1 text-[6px]", item.index === active && "text-[#7df89b]")}><item.icon className={cn("h-4 w-4", item.label === "Agendar" && "rounded-full bg-[#7df89b] p-0.5 text-black")} />{item.label}</span>)}</div>; }

function OwnerPhone() {
  return <div className="self-end"><PhoneShell><div className="h-full bg-[#0d0f14] px-3 pt-11 text-white"><div className="flex items-center gap-3"><div className="flex items-center gap-1 rounded-full border border-[#2a2d35] p-1 text-[8px]"><ChevronLeft className="h-3 w-3" /><b className="px-1">Hoje</b><ChevronRight className="h-3 w-3" /></div><div><small className="block text-[6px] uppercase tracking-wider text-[#777b85]">Segunda-feira</small><strong className="text-[11px]">10 de agosto</strong></div></div><div className="mt-3 flex items-center gap-1 text-[6px]">{["Dia", "Semana", "Mês", "Lista"].map((view, index) => <span key={view} className={cn("rounded-full border px-2 py-1.5", index === 0 ? "border-[#38d39f] bg-[#38d39f] text-black" : "border-[#2a2d35] text-[#898d97]")}>{view}</span>)}<span className="ml-auto rounded-full bg-[#38d39f] px-2.5 py-1.5 font-bold text-black">+ Novo</span></div><div className="mt-3 grid grid-cols-2 gap-1.5">{[["6", "Agendamentos", "text-[#55a8ff]"], ["1", "Em atendimento", "text-[#c66cff]"], ["340", "Receita realizada", "text-[#38d39f]"], ["610", "Receita prevista", "text-[#f5a623]"]].map((kpi) => <article key={kpi[1]} className="rounded-xl border border-[#282b33] bg-[#17191f] p-2.5"><b className={cn("block text-[10px]", kpi[2])}>{kpi[0]}</b><small className="text-[6px] text-[#777b85]">{kpi[1]}</small></article>)}</div><div className="mt-2 flex gap-1 overflow-hidden whitespace-nowrap text-[6px]"><span className="rounded-full border border-[#2a2d35] px-2 py-1.5 text-[#777b85]">Buscar cliente...</span><b className="rounded-full border border-[#38d39f] px-2 py-1.5 text-[#38d39f]">Todos profissionais</b><span className="rounded-full border border-[#2a2d35] px-2 py-1.5">Camila</span></div><div className="relative mt-2 h-[327px] overflow-hidden rounded-xl border border-[#282b33] bg-[#12141a]"><div className="grid h-10 grid-cols-[35px_1fr_1fr] border-b border-[#282b33] text-[7px]"><span /><b className="flex items-center justify-center gap-1"><i className="grid h-5 w-5 place-items-center rounded-full bg-purple-500 text-[5px] not-italic">CM</i>Camila</b><b className="flex items-center justify-center gap-1"><i className="grid h-5 w-5 place-items-center rounded-full bg-blue-500 text-[5px] not-italic">BR</i>Bruna</b></div><div className="absolute bottom-0 left-[35px] right-0 top-10 grid grid-rows-6">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="border-t border-[#242730]" />)}</div>{["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"].map((hour, index) => <span key={hour} className="absolute left-1 text-[5px] text-[#6d717b]" style={{ top: 40 + index * 47 }}>{hour}</span>)}<OwnerEvent className="left-[42px] top-[63px] border-[#38d39f] bg-[#123c32]" name="Mariana Lopes" service="Corte + escova" time="09:00 · Confirmado" /><OwnerEvent className="left-[155px] top-[106px] border-purple-400 bg-[#38224b]" name="Carla Souza" service="Manicure" time="10:30 · Em atendimento" /><OwnerEvent className="left-[42px] top-[193px] border-blue-400 bg-[#183147]" name="João Pereira" service="Corte masculino" time="12:00 · Pendente" /><OwnerEvent className="left-[155px] top-[254px] border-amber-400 bg-[#3f3118]" name="Paula Lima" service="Hidratação" time="13:30 · Confirmado" /><div className="absolute left-[32px] right-0 top-[176px] flex items-center"><i className="h-1.5 w-1.5 rounded-full bg-red-500" /><span className="h-px flex-1 bg-red-500" /></div></div></div><OwnerNav /></PhoneShell></div>;
}

function OwnerEvent({ className, name, service, time }: { className: string; name: string; service: string; time: string }) { return <article className={cn("absolute w-[102px] rounded-lg border-l-2 p-2 text-[6px]", className)}><b className="block text-[7px]">{name}</b><small className="block text-white/65">{service}</small><em className="mt-1 block not-italic text-white/75">{time}</em></article>; }

function OwnerNav() { const items = [{ icon: Grid2X2, label: "Início" }, { icon: CalendarDays, label: "Agenda" }, { icon: Users, label: "Clientes" }, { icon: Bell, label: "Alertas" }, { icon: Grid2X2, label: "Mais" }]; return <div className="absolute inset-x-0 bottom-0 z-20 grid h-[62px] grid-cols-5 border-t border-[#282b33] bg-[#12141a] text-[#777b85]">{items.map((item, index) => <span key={item.label} className={cn("grid place-content-center justify-items-center gap-1 text-[6px]", index === 1 && "text-[#38d39f]")}><item.icon className="h-4 w-4" />{item.label}</span>)}</div>; }
