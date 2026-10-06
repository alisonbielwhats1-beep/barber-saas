/** Conversation templates of the multi-salon generator (evaluation only). Written from scratch for this generator: they
 * share the harness FORMAT with the dev batteries, never their messages. Every template is salon-agnostic: the generator
 * binds its placeholders to a sampled salon (type, catalog subset, team, weekly hours), to names drawn from the pools and to
 * a date and clock form; the oracle is instantiated from the SAME bindings, so message and final state always agree.
 *
 * Placeholders `{binding}` or `{binding.attr}`:
 * - customers c1 c2 c3 / professionals p1 p2: `{c1}` what the owner says (first name; a nickname or an honorific form in
 *   those templates), `.nome` the stored full name, `.sobrenome`, `.o` a/o, `.do` da/do, `.pro` pra/pro, `.ele` ela/ele,
 *   `.dele` dela/dele;
 * - services s1 s2 s3: `{s1}` the mention (the service name, or the shared word in the ambiguity template), `.nome`;
 * - days d1 d2 d3: `{d1}` bare, `.na` "na terça" / "no dia 29", `.pra`, `.de`, `.spec` (oracle DaySpec);
 * - clocks h1..h4: `{h1}` bare, `.as` "às 10h", `.das`, `.pras`, `.hhmm` (oracle);
 * - `{motivo}` cancellation reason (`.M` capitalized, `.core` the literal core graded by the oracle), `{bmotivo}` a block
 *   reason; `{v.marcar}` `{v.remarcar}` `{v.cancelar}` `{v.bloquear}` the scenario's command verbs.
 * Texts are written in lower case where a sentence starts with a placeholder: typing mode capitalizes sentence starts,
 * voice mode drops punctuation. A variant `{ t, mode }` exists in one mode only. Several variants per message are split
 * between dev and holdout by a seeded hash (never by hand), so the holdout also measures unseen wording; phrasings that
 * read the same once names, days, clocks, punctuation and word order are neutralized always share a side.
 * `⟦...⟧` marks a span whose punctuation carries the meaning ("pras 17h... não, pras 15h" corrects, "pras 15h, não pras
 * 17h" contrasts): the generator turns it into a `noNoise` region, and such a variant is typing-only (dictation has no marks).
 * Two variants of one message never read the same without their unprotected punctuation while binding other values
 * (templateIssues in generate.ts).
 * This file holds the HOLDOUT-side phrasings too: whoever changes runtime code or the example bank never reads it.
 * v3: the sides of every v2 phrasing are pinned (phrase-sides-v2.json) and the v2 holdout phrasings are RETIRED for a new
 * holdout; a new phrasing may carry an explicit `side` (the rotated holdout pool is written with side: 'holdout'). */
export type Op = 'create' | 'reschedule' | 'cancel' | 'block' | 'read';
export type Mode = 'typing' | 'voice';
export type Special = 'customer-homonym' | 'pro-homonym' | 'nickname' | 'shared-word' | 'word-temporal' | 'word-service' | 'word-name' | 'honorific' | 'one-eligible';
export type Variant = string | { t: string; mode?: Mode; side?: 'dev' | 'holdout' };
export type TemplateStep = { say: number; expect?: 'READY' | 'READ_DONE' } | { confirm: true | 'all'; expectError?: string } | { select: string; optional?: true };
export type FinalAppointmentTemplate = { customer: string; service: string; day: string; time: string; professional: string; status?: 'CANCELLED'; reason?: string };
export type FinalTemplate = { appointments?: FinalAppointmentTemplate[]; blocks?: { professional: string; day: string; from: string; to: string }[];
  mustAsk?: string[]; noPendingPlan?: true; unchanged?: true };
/** Planning API: every call binds a placeholder or books an interval; an impossible request throws and the generator
 * retries the instance with the next attempt seed. Bookings of one professional never overlap unless a template says so. */
export interface Planner {
  service(name: string, o: { pro: string; with?: string[]; not?: string[]; minProServices?: number }): void;
  same(name: string, as: string): void;
  day(name: string, o?: { not?: string[] }): void;
  time(name: string, o: { day: string; pro: string; service: string; free?: string[]; book?: boolean }): void;
  span(from: string, to: string, o: { day: string; pro: string }): void;
  seed(customer: string, pro: string, service: string, day: string, time: string): void;
  book(pro: string, day: string, time: string, service: string): void;
  reason(name: string, of: string): void;
  blockReason(name: string): void;
}
export type Template = { id: string; title: string; ops: Op[]; tags: string[]; modes: Mode[]; customers: number; pros: number; special?: Special;
  /** forced date forms (per mode) */ dateForms?: Partial<Record<Mode, string[]>>;
  plan: (p: Planner) => void; says: Variant[][]; steps: TemplateStep[]; answers?: Record<string, Variant[]>; final: FinalTemplate };

const BOTH: Mode[] = ['typing', 'voice'];
const booked = (c: string, s: string, d: string, h: string, p: string) => ({ customer: `{${c}.nome}`, service: `{${s}.nome}`, day: `{${d}.spec}`, time: `{${h}.hhmm}`, professional: `{${p}.nome}` });
const cancelled = (c: string, s: string, d: string, h: string, p: string) => ({ ...booked(c, s, d, h, p), status: 'CANCELLED' as const, reason: '{motivo.core}' });
const createSays: Variant[] = [
  '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}.',
  '{v.marcar} {s1} {c1.pro} {c1} {d1.na}, {h1.as}, com {p1.o} {p1}.',
  '{c1.o} {c1} quer fazer {s1} com {p1.o} {p1} {d1.na} {h1.as}, {v.marcar} {c1.ele} pra mim.',
  '{c1.o} {c1} vem {d1.na} {h1.as} fazer {s1} com {p1.o} {p1}. {v.marcar}.',
];
const createPlan = (p: Planner) => { p.service('s1', { pro: 'p1' }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1' }); };
const seededPlan = (p: Planner) => { p.service('s1', { pro: 'p1' }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1', book: false }); p.seed('c1', 'p1', 's1', 'd1', 'h1'); };
const reasonAnswers: Variant[] = ['{motivo.M}.', 'É que {motivo}.', '{motivo}', 'Motivo: {motivo}.'];
const timeAnswers = (h: string): Variant[] => [`{${h}.as}`, `Pode ser {${h}.as}.`, `{${h}}, se tiver.`, `Coloca {${h}.as}.`];
const blockReasonAnswers: Variant[] = ['{p1.ele} vai {bmotivo}.', 'Compromisso pessoal {p1.dele}.', 'Assunto particular.'];

export const TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- create
  { id: 'T01', title: 'criar com tudo informado', ops: ['create'], tags: [], modes: BOTH, customers: 1, pros: 1, plan: createPlan,
    says: [[...createSays, { t: '{v.marcar} na agenda {p1.do} {p1}: {c1.o} {c1}, {s1}, {d1}, {h1}.', mode: 'typing' }, { t: '{v.marcar} {c1} {d1} {h1} {s1} c/ {p1}', mode: 'typing' }]],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T02', title: 'criar ditado por voz', ops: ['create'], tags: ['dictated'], modes: ['voice'], customers: 1, pros: 1, plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra fazer {s1} com {p1.o} {p1}', '{v.marcar} pra mim {c1.o} {c1} {d1.na} {h1.as} com {p1.o} {p1} é pra {s1}',
      '{c1.o} {c1} vai vir {d1.na} {h1.as} fazer {s1} com {p1.o} {p1} {v.marcar} {c1.ele} aí', '{v.marcar} {s1} com {p1.o} {p1} {d1.na} {h1.as} {c1.pro} {c1}']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T03', title: 'criar sem horário (pergunta o horário)', ops: ['create'], tags: ['ask-time'], modes: BOTH, customers: 1, pros: 1, plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} pra {s1} com {p1.o} {p1}.', '{c1.o} {c1} quer {s1} com {p1.o} {p1} {d1.na}. {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1} com {p1.o} {p1}, {d1}.', '{v.marcar} um horário {c1.pro} {c1} {d1.na}, {s1} com {p1.o} {p1}.']],
    answers: { time: timeAnswers('h1') }, steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['time'] } },
  { id: 'T04', title: 'criar sem serviço (pergunta o serviço)', ops: ['create'], tags: ['ask-service'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { p.service('s1', { pro: 'p1', minProServices: 2 }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1' }); },
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} com {p1.o} {p1}.', '{c1.o} {c1} vem {d1.na} {h1.as}, {v.marcar} com {p1.o} {p1}.',
      '{v.marcar} um horário {c1.pro} {c1} com {p1.o} {p1} {d1.na} {h1.as}.', '{v.marcar} {d1.na} {h1.as} {c1.pro} {c1}, com {p1.o} {p1}.']],
    answers: { service_name: ['{s1}', 'É {s1}.', 'Vai fazer {s1}.', 'Pra {s1}.'], service_ref: ['{s1}', 'É {s1}.', 'Vai fazer {s1}.', 'Pra {s1}.'] },
    // A write without a service question is an invented service (right only by chance when the guess is s1).
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['service_ref', 'selection'] } },
  { id: 'T05', title: 'criar sem profissional (só uma faz o serviço)', ops: ['create'], tags: ['one-eligible'], modes: BOTH, customers: 1, pros: 1, special: 'one-eligible', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1}.', '{c1.o} {c1} quer fazer {s1} {d1.na} {h1.as}. {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1}, {d1}, {h1.as}.', '{v.marcar} {c1.o} {c1} pra {s1}: {d1}, {h1}.']],
    answers: { professional_ref: ['Com {p1.o} {p1}.', '{p1}', 'Pode ser com {p1.o} {p1}.'] },
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T06', title: 'criar em horário ocupado (pede outro horário)', ops: ['create'], tags: ['conflict'], modes: BOTH, customers: 2, pros: 1,
    plan: p => { p.service('s1', { pro: 'p1' }); p.service('s2', { pro: 'p1' }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1', book: false });
      p.seed('c2', 'p1', 's2', 'd1', 'h1'); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); },
    // F5 (v3): the Secretária may first ask the conflict questions ("encaixo ou outro horário?", override_requested /
    // destination_mode, with the free slots): the owner declines the overbooking and gives h2; c2 stays untouched.
    says: [createSays], answers: { time: ['Então {h2.as}.', 'Pode ser {h2.as} então.', '{h2.as}', 'Tenta {h2.as}.'],
      override_requested: ['Não precisa encaixar, pode ser {h2.as}.', 'Sem encaixe. {h2.as}, então.', 'Encaixe não, prefiro {h2.as}.'],
      destination_mode: ['Outro horário: {h2.as}.', 'Prefiro outro horário, {h2.as}.', 'Pode mudar {h2.pras}.'], date: ['{d1.na} mesmo.', 'No mesmo dia, {d1.na}.'] },
    steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [booked('c2', 's2', 'd1', 'h1', 'p1'), booked('c1', 's1', 'd1', 'h2', 'p1')], mustAsk: ['time', 'date', 'selection', 'override_requested', 'destination_mode'] } },
  { id: 'T07', title: 'criar com dia da semana e data juntos', ops: ['create'], tags: ['date-combo'], modes: BOTH, customers: 1, pros: 1, plan: createPlan,
    dateForms: { typing: ['weekday-dia', 'weekday-ddmm'], voice: ['weekday-dia-dw'] },
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} com {p1.o} {p1} pra {s1}.', '{d1.na}, {h1.as}, {v.marcar} {s1} {c1.pro} {c1} com {p1.o} {p1}.',
      '{v.marcar} {c1.o} {c1} pra {s1} com {p1.o} {p1}: {d1}, {h1.as}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  // ---------------------------------------------------------------- reschedule
  { id: 'T10', title: 'remarcar o horário no mesmo dia', ops: ['reschedule'], tags: [], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}.', '{v.remarcar} o horário {c1.do} {c1} {d1.de} {h1.das} {h2.pras}.',
      '{c1.o} {c1} {d1.de} vai vir {h2.as} em vez {h1.das}. {v.remarcar} {c1.ele}.', '{v.remarcar} {c1.o} {c1} que está {d1.na} {h1.as} {h2.pras}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h2', 'p1')] } },
  { id: 'T11', title: 'remarcar para outro dia com horário', ops: ['reschedule'], tags: [], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p1', service: 's1' }); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {d2.pra}, {h2.as}.', '{c1.o} {c1} não pode {d1.na}. {v.remarcar} {c1.ele} {d2.pra} {h2.as}.',
      '{v.remarcar} o horário {c1.do} {c1} {d1.de} {d2.pra} {h2.as}.', '{v.remarcar} {c1.o} {c1}: sai {d1.de} e vai {d2.pra}, {h2.as}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd2', 'h2', 'p1')] } },
  { id: 'T12', title: 'remarcar para outro dia sem horário (pergunta o horário)', ops: ['reschedule'], tags: ['ask-time'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p1', service: 's1' }); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {d2.pra}.', '{c1.o} {c1} pediu pra passar o horário {d1.de} {d2.pra}.',
      '{v.remarcar} o horário {c1.do} {c1} {d2.pra}.', '{v.remarcar} {c1.o} {c1} {d2.pra}, {c1.ele} não consegue {d1.na}.']],
    answers: { time: timeAnswers('h2') }, steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd2', 'h2', 'p1')], mustAsk: ['time'] } },
  { id: 'T13', title: 'trocar a profissional no mesmo horário', ops: ['reschedule'], tags: ['change-professional'], modes: BOTH, customers: 1, pros: 2,
    plan: p => { p.service('s1', { pro: 'p1', with: ['p2'] }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1', free: ['p2'], book: false });
      p.seed('c1', 'p1', 's1', 'd1', 'h1'); p.book('p2', 'd1', 'h1', 's1'); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {p2.pro} {p2}, no mesmo horário.', '{c1.o} {c1} {d1.de} vai ser com {p2.o} {p2} em vez {p1.do} {p1}, mesmo horário.',
      'Troca quem atende {c1.o} {c1} {d1.na}: {p2.o} {p2} no lugar {p1.do} {p1}.', '{v.remarcar} o horário {c1.do} {c1} {d1.de} {h1.das} {p2.pro} {p2}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p2')] } },
  { id: 'T14', title: 'remarcar ditado por voz', ops: ['reschedule'], tags: ['dictated'], modes: ['voice'], customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p1', service: 's1' }); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {d2.pra} {h2.as}', 'o horário {c1.do} {c1} {d1.de} {v.remarcar} {d2.pra} {h2.as}',
      '{v.remarcar} pra mim {c1.o} {c1} {d1.de} {d2.pra} {h2.as} com {p1.o} {p1} mesmo']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd2', 'h2', 'p1')] } },
  { id: 'T15', title: 'remarcar corrigindo o horário na mesma frase', ops: ['reschedule'], tags: ['correction'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); p.time('h3', { day: 'd1', pro: 'p1', service: 's1', book: false }); },
    says: [[{ t: '{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}⟦, não {h3.pras}⟧.', mode: 'typing' }, { t: '{v.remarcar} {c1.o} {c1} {d1.de} {h3.pras}⟦... não, {h2.pras}⟧.', mode: 'typing' },
      '{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras} e não {h3.pras}.', '{v.remarcar} {c1.o} {c1} {d1.de} {h3.pras}, quer dizer, {h2.pras}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h2', 'p1')] } },
  // ---------------------------------------------------------------- cancel
  { id: 'T20', title: 'cancelar com motivo na frase', ops: ['cancel'], tags: [], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} {c1.o} {c1} {d1.de}, {motivo}.', '{v.cancelar} o horário {c1.do} {c1} {d1.de} {h1.das}, porque {motivo}.',
      '{v.cancelar} {c1.o} {c1} {d1.de}. {motivo.M}.', '{v.cancelar} o horário de {s1} {c1.do} {c1} {d1.de}, {motivo}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: true }], final: { appointments: [cancelled('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T21', title: 'cancelar e responder o motivo', ops: ['cancel'], tags: ['ask-reason'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} {c1.o} {c1} {d1.de}.', '{v.cancelar} o horário {c1.do} {c1} {d1.de} {h1.das}.', '{c1.o} {c1} {d1.de}: {v.cancelar}.',
      '{v.cancelar} o horário de {s1} {c1.do} {c1} {d1.na}.']],
    answers: { reason: reasonAnswers }, steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [cancelled('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['reason'] } },
  { id: 'T22', title: 'cancelar ditado com motivo', ops: ['cancel'], tags: ['dictated'], modes: ['voice'], customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} {c1.o} {c1} {d1.de} {h1.das} porque {motivo}', '{v.cancelar} o horário {c1.do} {c1} {d1.de} {motivo}',
      '{c1.o} {c1} {d1.de} {v.cancelar} que {motivo}']],
    answers: { reason: ['{motivo}', 'é que {motivo}'] }, steps: [{ say: 0 }, { confirm: true }], final: { appointments: [cancelled('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T23', title: 'cancelar um de dois horários da cliente', ops: ['cancel'], tags: ['two-appointments'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p1', service: 's1', book: false }); p.seed('c1', 'p1', 's1', 'd2', 'h2'); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} só o horário {c1.do} {c1} {d2.de}, {motivo}.', '{c1.o} {c1} tem dois horários marcados; {v.cancelar} o {d2.de}, {motivo}.',
      '{v.cancelar} o horário {c1.do} {c1} {d2.de} {h2.das}, {motivo}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1'), { ...cancelled('c1', 's1', 'd2', 'h2', 'p1') }] } },
  { id: 'T24', title: 'cancelar sem dizer qual dos dois horários (pergunta)', ops: ['cancel'], tags: ['two-appointments', 'ask-appointment'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p1', service: 's1', book: false }); p.seed('c1', 'p1', 's1', 'd2', 'h2'); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} o horário {c1.do} {c1}, {motivo}.', '{v.cancelar} {c1.o} {c1}, {motivo}.', '{c1.o} {c1} avisou que {motivo}. {v.cancelar} o horário {c1.dele}.']],
    answers: { appointment_ref: ['O {d2.de}.', 'O {d2.de}, {h2.das}.', 'O que é {d2.na}.'], date: ['{d2.na}', '{d2}'], reason: ['{motivo.M}.', 'É que {motivo}.'] },
    steps: [{ say: 0 }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1'), cancelled('c1', 's1', 'd2', 'h2', 'p1')], mustAsk: ['appointment_ref', 'selection', 'date'] } },
  // ---------------------------------------------------------------- block
  { id: 'T30', title: 'bloquear um intervalo da agenda', ops: ['block'], tags: [], modes: BOTH, customers: 0, pros: 1,
    plan: p => { p.day('d1'); p.span('h1', 'h2', { day: 'd1', pro: 'p1' }); p.blockReason('bmotivo'); },
    says: [['{v.bloquear} a agenda {p1.do} {p1} {d1.na} {h1.das} {h2.as}.', '{p1.o} {p1} vai sair {d1.na} {h1.das} {h2.as}. {v.bloquear} esse horário na agenda {p1.dele}.',
      '{v.bloquear} {d1.na}, {h1.das} {h2.as}, {p1.pro} {p1}.']],
    answers: { reason: blockReasonAnswers }, steps: [{ say: 0 }, { confirm: true }],
    final: { blocks: [{ professional: '{p1.nome}', day: '{d1.spec}', from: '{h1.hhmm}', to: '{h2.hhmm}' }] } },
  { id: 'T31', title: 'bloquear ditado por voz', ops: ['block'], tags: ['dictated'], modes: ['voice'], customers: 0, pros: 1,
    plan: p => { p.day('d1'); p.span('h1', 'h2', { day: 'd1', pro: 'p1' }); p.blockReason('bmotivo'); },
    says: [['{v.bloquear} a agenda {p1.do} {p1} {d1.na} {h1.das} {h2.as}', '{p1.o} {p1} tem um compromisso {d1.na} {h1.das} {h2.as} {v.bloquear} a agenda {p1.dele} nesse horário',
      '{v.bloquear} pra mim {d1.na} {h1.das} {h2.as} na agenda {p1.do} {p1}']],
    answers: { reason: blockReasonAnswers }, steps: [{ say: 0 }, { confirm: true }],
    final: { blocks: [{ professional: '{p1.nome}', day: '{d1.spec}', from: '{h1.hhmm}', to: '{h2.hhmm}' }] } },
  { id: 'T32', title: 'bloquear com motivo na frase', ops: ['block'], tags: ['block-reason'], modes: BOTH, customers: 0, pros: 1,
    plan: p => { p.day('d1'); p.span('h1', 'h2', { day: 'd1', pro: 'p1' }); p.blockReason('bmotivo'); },
    says: [['{v.bloquear} a agenda {p1.do} {p1} {d1.na} {h1.das} {h2.as}, {p1.ele} vai {bmotivo}.', '{p1.o} {p1} vai {bmotivo} {d1.na}, {h1.das} {h2.as}. {v.bloquear} a agenda {p1.dele}.',
      '{v.bloquear} {h1.das} {h2.as} {d1.na} na agenda {p1.do} {p1} porque {p1.ele} vai {bmotivo}.']],
    answers: { reason: ['{p1.ele} vai {bmotivo}.', 'É que {p1.ele} vai {bmotivo}.'] }, steps: [{ say: 0 }, { confirm: true }],
    final: { blocks: [{ professional: '{p1.nome}', day: '{d1.spec}', from: '{h1.hhmm}', to: '{h2.hhmm}' }] } },
  // ---------------------------------------------------------------- read
  { id: 'T35', title: 'consultar a agenda do dia da profissional', ops: ['read'], tags: ['day-agenda'], modes: BOTH, customers: 2, pros: 1,
    plan: p => { seededPlan(p); p.service('s2', { pro: 'p1' }); p.time('h2', { day: 'd1', pro: 'p1', service: 's2', book: false }); p.seed('c2', 'p1', 's2', 'd1', 'h2'); },
    says: [['Como está a agenda {p1.do} {p1} {d1.na}?', 'O que {p1.o} {p1} tem marcado {d1.na}?', 'Me mostra a agenda {p1.do} {p1} {d1.na}.', 'Quem {p1.o} {p1} atende {d1.na}?']],
    steps: [{ say: 0, expect: 'READ_DONE' }], final: { unchanged: true } },
  { id: 'T36', title: 'consultar horários livres para um serviço', ops: ['read'], tags: ['availability'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { seededPlan(p); },
    says: [['{p1.o} {p1} tem horário livre {d1.na} pra {s1}?', 'Quais horários {p1.o} {p1} tem {d1.na} pra fazer {s1}?', 'Tem vaga com {p1.o} {p1} {d1.na} pra {s1}? Quais horários?',
      'Me diz os horários vagos {p1.do} {p1} {d1.na} pra {s1}.']],
    steps: [{ say: 0, expect: 'READ_DONE' }], final: { unchanged: true } },
  // ---------------------------------------------------------------- multi-action
  { id: 'T40', title: 'marcar duas clientes com a mesma profissional', ops: ['create'], tags: ['multi-action'], modes: BOTH, customers: 2, pros: 1,
    plan: p => { createPlan(p); p.same('s2', 's1'); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); },
    says: [['{v.marcar} {c1.o} {c1} {h1.as} e {c2.o} {c2} {h2.as}, {d1.na} com {p1.o} {p1}, pra {s1}.',
      '{d1.na} com {p1.o} {p1}: {c1.o} {c1} {h1.as} pra {s1} e {c2.o} {c2} {h2.as} pra {s2}. {v.marcar} os dois horários.',
      '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1} e {c2.o} {c2} {h2.as}, também pra {s1}.']],
    steps: [{ say: 0 }, { confirm: 'all' }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1'), booked('c2', 's1', 'd1', 'h2', 'p1')] } },
  { id: 'T41', title: 'cancelar e colocar outra cliente no lugar', ops: ['cancel', 'create'], tags: ['multi-action', 'released-slot'], modes: BOTH, customers: 2, pros: 1,
    plan: p => { seededPlan(p); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} {c1.o} {c1} {d1.de}, {motivo}, e {v.marcar} {c2.o} {c2} no lugar {c1.dele}, também pra {s1}.',
      '{v.cancelar} o horário {c1.do} {c1} {d1.de} {h1.das} porque {motivo}, e {v.marcar} {c2.o} {c2} nesse horário pra {s1}.',
      '{v.cancelar} {c1.o} {c1} {d1.de} porque {motivo} e {v.marcar} {c2.o} {c2} no mesmo horário pra {s1}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: 'all' }],
    final: { appointments: [cancelled('c1', 's1', 'd1', 'h1', 'p1'), booked('c2', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T42', title: 'remarcar uma cliente e cancelar outra', ops: ['reschedule', 'cancel'], tags: ['multi-action'], modes: BOTH, customers: 2, pros: 2,
    plan: p => { seededPlan(p); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); p.service('s2', { pro: 'p2' }); p.day('d2'); p.time('h3', { day: 'd2', pro: 'p2', service: 's2', book: false });
      p.seed('c2', 'p2', 's2', 'd2', 'h3'); p.reason('motivo', 'c2'); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras} e {v.cancelar} {c2.o} {c2} {d2.de}, {motivo}.',
      'Duas coisas: {c1.o} {c1} {d1.de} passa {h2.pras}; e {c2.o} {c2} {d2.de} cancela, {motivo}.',
      '{v.cancelar} {c2.o} {c2} {d2.de} porque {motivo}, e {v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: 'all' }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h2', 'p1'), cancelled('c2', 's2', 'd2', 'h3', 'p2')] } },
  { id: 'T43', title: 'marcar uma cliente e bloquear outro intervalo', ops: ['create', 'block'], tags: ['multi-action'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { createPlan(p); p.span('h2', 'h3', { day: 'd1', pro: 'p1' }); p.blockReason('bmotivo'); },
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1} e {v.bloquear} a agenda {p1.dele} {h2.das} {h3.as}.',
      '{d1.na}: {v.marcar} {c1.o} {c1} {h1.as} pra {s1} com {p1.o} {p1}, e {h2.das} {h3.as} {v.bloquear} a agenda {p1.dele}.',
      '{v.bloquear} a agenda {p1.do} {p1} {d1.na} {h2.das} {h3.as} e {v.marcar} {c1.o} {c1} {h1.as} com {p1.ele} pra {s1}.']],
    answers: { reason: blockReasonAnswers }, steps: [{ say: 0 }, { confirm: 'all' }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], blocks: [{ professional: '{p1.nome}', day: '{d1.spec}', from: '{h2.hhmm}', to: '{h3.hhmm}' }] } },
  { id: 'T44', title: 'três ações: marcar, remarcar e cancelar', ops: ['create', 'reschedule', 'cancel'], tags: ['multi-action', 'three-actions'], modes: BOTH, customers: 3, pros: 2,
    plan: p => { createPlan(p); p.service('s2', { pro: 'p2' }); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p2', service: 's2', book: false }); p.seed('c2', 'p2', 's2', 'd2', 'h2');
      p.time('h3', { day: 'd2', pro: 'p2', service: 's2' }); p.service('s3', { pro: 'p1' }); p.day('d3', { not: ['d1', 'd2'] });
      p.time('h4', { day: 'd3', pro: 'p1', service: 's3', book: false }); p.seed('c3', 'p1', 's3', 'd3', 'h4'); p.reason('motivo', 'c3'); },
    says: [['Três coisas: {v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}; {v.remarcar} {c2.o} {c2} {d2.de} {h3.pras}; e {v.cancelar} {c3.o} {c3} {d3.de}, {motivo}.',
      '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} com {p1.o} {p1} pra {s1}, {v.remarcar} {c2.o} {c2} {d2.de} {h3.pras} e {v.cancelar} {c3.o} {c3} {d3.de} porque {motivo}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: 'all' }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1'), booked('c2', 's2', 'd2', 'h3', 'p2'), cancelled('c3', 's3', 'd3', 'h4', 'p1')] } },
  { id: 'T45', title: 'marcar duas clientes em dias e profissionais diferentes', ops: ['create'], tags: ['multi-action'], modes: BOTH, customers: 2, pros: 2,
    plan: p => { createPlan(p); p.service('s2', { pro: 'p2' }); p.day('d2', { not: ['d1'] }); p.time('h2', { day: 'd2', pro: 'p2', service: 's2' }); },
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} com {p1.o} {p1} pra {s1} e {c2.o} {c2} {d2.na} {h2.as} com {p2.o} {p2} pra {s2}.',
      'Dois horários: {c1.o} {c1}, {s1} com {p1.o} {p1}, {d1.na} {h1.as}; {c2.o} {c2}, {s2} com {p2.o} {p2}, {d2.na} {h2.as}. {v.marcar} os dois.',
      '{c1.o} {c1} quer {s1} {d1.na} {h1.as} com {p1.o} {p1}, e {c2.o} {c2} quer {s2} {d2.na} {h2.as} com {p2.o} {p2}. {v.marcar} pra mim.']],
    steps: [{ say: 0 }, { confirm: 'all' }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1'), booked('c2', 's2', 'd2', 'h2', 'p2')] } },
  // ---------------------------------------------------------------- names, homonyms, nicknames, ambiguous service
  { id: 'T50', title: 'duas clientes com o mesmo nome (pergunta qual)', ops: ['create'], tags: ['homonym'], modes: BOTH, customers: 1, pros: 1, special: 'customer-homonym', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}.', '{c1.o} {c1} quer {s1} {d1.na} {h1.as} com {p1.o} {p1}, {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1} {d1.na}, {h1.as}, com {p1.o} {p1}.']],
    answers: { customer_ref: ['{c1.o} {c1.nome}', 'É {c1.o} {c1.nome}.', '{c1.nome}'] },
    steps: [{ say: 0 }, { select: '{c1.sobrenome}', optional: true }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['customer_ref', 'selection'] } },
  { id: 'T51', title: 'duas profissionais com o mesmo nome (pergunta qual)', ops: ['create'], tags: ['homonym', 'homonym-professional'], modes: BOTH, customers: 1, pros: 1, special: 'pro-homonym',
    plan: p => { p.service('s1', { pro: 'p1', with: ['p1h'] }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1', free: ['p1h'] }); },
    says: [createSays.slice(0, 3)],
    answers: { professional_ref: ['Com {p1.o} {p1.nome}.', '{p1.nome}', 'É {p1.o} {p1.nome}.'] },
    steps: [{ say: 0 }, { select: '{p1.sobrenome}', optional: true }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['professional_ref', 'selection'] } },
  // The runtime finds a customer by a case/accent-insensitive substring of the name: the generator keeps `mustAsk` when the
  // nickname finds none or several customers and drops it (tag nickname-unique) when it finds exactly this one.
  { id: 'T52', title: 'cliente chamada pelo apelido (pergunta quem é quando a busca não acha uma só)', ops: ['create'], tags: ['nickname'], modes: BOTH, customers: 1, pros: 1, special: 'nickname', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}.', '{c1.o} {c1} vem {d1.na} {h1.as} fazer {s1} com {p1.o} {p1}, {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1} {d1.na} {h1.as} com {p1.o} {p1}.']],
    answers: { customer_ref: ['É {c1.o} {c1.nome}.', '{c1.nome}', '{c1.o} {c1.nome}, {c1.o} {c1}.'] },
    steps: [{ say: 0 }, { select: '{c1.sobrenome}', optional: true }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['customer_ref', 'selection'] } },
  { id: 'T53', title: 'serviço dito por palavra comum a dois serviços (pergunta qual)', ops: ['create'], tags: ['service-ambiguous'], modes: BOTH, customers: 1, pros: 1, special: 'shared-word', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}.', '{c1.o} {c1} quer fazer {s1} com {p1.o} {p1} {d1.na} {h1.as}, {v.marcar} pra mim.',
      '{v.marcar} {s1} {c1.pro} {c1} {d1.na} {h1.as} com {p1.o} {p1}.']],
    answers: { service_ref: ['{s1.nome}', 'É {s1.nome}.', 'Vai ser {s1.nome}.'], service_name: ['{s1.nome}', 'É {s1.nome}.', 'Vai ser {s1.nome}.'] },
    steps: [{ say: 0 }, { select: '{s1.nome}', optional: true }, { confirm: true }],
    final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')], mustAsk: ['service_ref', 'selection'] } },
  { id: 'T54', title: 'cliente com nome que parece dia ou número', ops: ['create'], tags: ['word-name', 'name-temporal'], modes: BOTH, customers: 1, pros: 1, special: 'word-temporal', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1}.', '{c1.o} {c1} quer {s1} {d1.na} {h1.as} com {p1.o} {p1}. {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1} com {p1.o} {p1}, {d1}, {h1.as}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T55', title: 'cliente com nome parecido com serviço', ops: ['create'], tags: ['word-name', 'name-service'], modes: BOTH, customers: 1, pros: 1, special: 'word-service', plan: createPlan,
    says: [['{v.marcar} {c1.o} {c1} pra {s1} {d1.na} {h1.as} com {p1.o} {p1}.', '{c1.o} {c1} vem fazer {s1} {d1.na} {h1.as} com {p1.o} {p1}, {v.marcar} {c1.ele}.',
      '{v.marcar} {s1} {c1.pro} {c1} {d1.na}, {h1.as}, com {p1.o} {p1}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T56', title: 'cliente chamada com tratamento (Dona, Seu, Dra.)', ops: ['reschedule'], tags: ['honorific'], modes: BOTH, customers: 1, pros: 1, special: 'honorific',
    plan: p => { seededPlan(p); p.time('h2', { day: 'd1', pro: 'p1', service: 's1' }); },
    says: [['{v.remarcar} {c1.o} {c1} {d1.de} {h2.pras}.', '{c1.o} {c1} pediu pra vir {h2.as} {d1.na}, em vez {h1.das}. {v.remarcar} {c1.ele}.',
      '{v.remarcar} o horário {c1.do} {c1} {d1.de} {h2.pras}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h2', 'p1')] } },
  { id: 'T57', title: 'cancelar cliente com nome que também é palavra', ops: ['cancel'], tags: ['word-name'], modes: BOTH, customers: 1, pros: 1, special: 'word-name',
    plan: p => { seededPlan(p); p.reason('motivo', 'c1'); },
    says: [['{v.cancelar} {c1.o} {c1} {d1.de}, {motivo}.', '{v.cancelar} o horário {c1.do} {c1} {d1.de} {h1.das}. {motivo.M}.', '{c1.o} {c1} {d1.de}: {v.cancelar}, {motivo}.']],
    answers: { reason: ['{motivo.M}.', 'É que {motivo}.'] }, steps: [{ say: 0 }, { confirm: true }], final: { appointments: [cancelled('c1', 's1', 'd1', 'h1', 'p1')] } },
  // ---------------------------------------------------------------- negation and self-correction
  { id: 'T60', title: 'desistir do pedido antes de confirmar', ops: ['create'], tags: ['negation'], modes: BOTH, customers: 1, pros: 1, plan: createPlan,
    says: [createSays.slice(0, 3), ['Não, esquece. Deixa como está.', 'Pensando bem, não precisa marcar.', 'Não, deixa pra lá, não marca.', 'Esquece esse horário, não vou marcar agora.']],
    steps: [{ say: 0, expect: 'READY' }, { say: 1 }, { confirm: true, expectError: 'NOTHING_TO_CONFIRM' }], final: { unchanged: true, noPendingPlan: true } },
  { id: 'T61', title: 'corrigir a profissional na mesma frase', ops: ['create'], tags: ['correction'], modes: BOTH, customers: 1, pros: 2,
    plan: p => { p.service('s1', { pro: 'p1', with: ['p2'] }); p.day('d1'); p.time('h1', { day: 'd1', pro: 'p1', service: 's1', free: ['p2'] }); },
    says: [[{ t: '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p2.o} {p2}⟦... não, com {p1.o} {p1}⟧.', mode: 'typing' },
      { t: '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1}, com {p1.o} {p1}⟦, não com {p2.o} {p2}⟧.', mode: 'typing' },
      '{v.marcar} {c1.o} {c1} {d1.na} {h1.as} pra {s1} com {p1.o} {p1} e não com {p2.o} {p2}.', '{v.marcar} {c1.o} {c1} com {p2.o} {p2}, quer dizer, com {p1.o} {p1}, {d1.na} {h1.as} pra {s1}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
  { id: 'T62', title: 'corrigir o dia na mesma frase', ops: ['create'], tags: ['correction'], modes: BOTH, customers: 1, pros: 1,
    plan: p => { createPlan(p); p.day('d2', { not: ['d1'] }); },
    says: [[{ t: '{v.marcar} {c1.o} {c1} {d2.na}⟦... não, {d1.na}⟧, {h1.as} pra {s1} com {p1.o} {p1}.', mode: 'typing' },
      { t: '{v.marcar} {c1.o} {c1} {d1.na}⟦, não {d2.na}⟧, {h1.as} pra {s1} com {p1.o} {p1}.', mode: 'typing' },
      '{v.marcar} {c1.o} {c1} {d1.na} e não {d2.na}, {h1.as} pra {s1} com {p1.o} {p1}.', '{v.marcar} {c1.o} {c1} {d2.na}, quer dizer, {d1.na}, {h1.as}, pra {s1} com {p1.o} {p1}.']],
    steps: [{ say: 0 }, { confirm: true }], final: { appointments: [booked('c1', 's1', 'd1', 'h1', 'p1')] } },
];

/** v3: replies to the half-of-day question ("2h ou 14h?") that a template gets only when the tenant hours leave both
 * readings of a clock the owner wrote open (generate.ts, daypart rule). `{h9}` stands for that clock and is always
 * rendered unambiguously here (24-hour clock, or the part of the day for an early hour). */
export const DAYPART_ANSWERS: Variant[] = ['{h9.as}.', 'É {h9.as}.', 'Isso, {h9.as}.', 'Quero {h9.as}.', 'Pode ser {h9.as}, por favor.'];
/** Cancellation reasons (the owner's words; `{ele}`/`{dele}` agree with the customer). `core` is the literal the stored
 * reason must contain. No operation verb, clock, day, name or service word. */
export const REASONS: { text: string; core: string }[] = [
  { text: '{ele} vai viajar a trabalho', core: 'viajar a trabalho' }, { text: '{ele} pegou uma gripe forte', core: 'gripe forte' },
  { text: '{ele} teve um imprevisto no trabalho', core: 'imprevisto no trabalho' }, { text: '{ele} tem consulta médica', core: 'consulta médica' },
  { text: 'o carro {dele} quebrou', core: 'quebrou' }, { text: '{ele} mudou de cidade', core: 'mudou de cidade' },
  { text: 'a filha {dele} ficou doente', core: 'ficou doente' }, { text: '{ele} não vai conseguir vir', core: 'conseguir vir' },
  { text: '{ele} vai ao casamento da irmã', core: 'casamento da irmã' }, { text: '{ele} precisou fazer uma cirurgia', core: 'fazer uma cirurgia' },
  { text: '{ele} está sem transporte', core: 'sem transporte' }, { text: '{ele} tem prova na faculdade', core: 'prova na faculdade' },
  { text: '{ele} teve um problema de família', core: 'problema de família' }, { text: 'alagou a rua {dele}', core: 'alagou a rua' },
  { text: '{ele} vai estar de plantão no hospital', core: 'plantão no hospital' }, { text: '{ele} vai cuidar da mãe', core: 'cuidar da mãe' },
];
/** What a professional will do during a block ("vai ..."). */
export const BLOCK_REASONS = ['levar o filho ao médico', 'fazer um curso', 'resolver coisas no banco', 'ao dentista', 'buscar a filha na escola', 'fazer um exame',
  'a uma reunião com fornecedor', 'renovar a carteira de motorista'];
/** Command verbs per operation (imperative; formal subjunctive forms included). */
export const VERB_POOLS: Record<'marcar' | 'remarcar' | 'cancelar' | 'bloquear', string[]> = {
  marcar: ['marca', 'agenda', 'coloca', 'bota', 'anota', 'põe', 'marque', 'agende', 'coloque'],
  remarcar: ['passa', 'muda', 'remarca', 'joga', 'transfere', 'reagenda', 'passe', 'mude', 'remarque'],
  cancelar: ['cancela', 'desmarca', 'tira', 'cancele', 'desmarque'],
  bloquear: ['bloqueia', 'fecha', 'trava', 'bloqueie', 'feche'],
};
