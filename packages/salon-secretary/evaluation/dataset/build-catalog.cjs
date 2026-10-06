'use strict';
/** Evaluation dataset catalog of the Secretária Agenda program (offline, read-only over every source).
 *   node packages/salon-secretary/evaluation/dataset/build-catalog.cjs          # writes the 3 outputs below
 *   node packages/salon-secretary/evaluation/dataset/build-catalog.cjs --check  # exit 1 when an output would change
 * Writes ONLY: dataset/catalog.json, dataset/coverage.md, .demo/agenda-core/oracle-audit/catalog-crosschecks.json.
 * Sources (read only): dev batteries V/N, legacy practices A/B/C, multi-salon generated DEV split, Golden 30
 * (free-use-golden-30.json; ids cross-checked with free-use-golden.ts), holdout-registry.json (sealed/validation sets:
 * ids and sha256 only, never contents), run results under results/agenda-core (passk.json; legacy flat runs regraded
 * with the frozen E map exactly like agenda-practice-lib.ts) and Golden runs under results/free-use/golden-*.
 * Never opens D:/Projetos/secretary-holdout-sealed or D:/Projetos/secretary-validation, never reads a run folder with a
 * sealed/validation marker, and never reads a run that holds a scenario id unknown to the catalog. No database, no
 * network, no model. Output carries ids, codes, counts and hashes only: no message text, customer name or reason. */
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EVAL = 'packages/salon-secretary/evaluation';
const OUT = { catalog: `${EVAL}/dataset/catalog.json`, coverage: `${EVAL}/dataset/coverage.md`, audit: '.demo/agenda-core/oracle-audit/catalog-crosschecks.json' };
const FORBIDDEN = ['D:/Projetos/secretary-holdout-sealed', 'D:/Projetos/secretary-validation'].map(p => path.resolve(p).toLowerCase());
const abs = rel => {
  const p = path.resolve(ROOT, rel);
  if (FORBIDDEN.some(f => p.toLowerCase().startsWith(f))) throw Error('CATALOG_FORBIDDEN_PATH');
  return p;
};
const exists = rel => fs.existsSync(abs(rel));
const readText = rel => fs.readFileSync(abs(rel), 'utf8');
const readBytes = rel => fs.readFileSync(abs(rel));
const readJson = rel => JSON.parse(readText(rel).replace(/^\uFEFF/, ''));
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
// Same canonical JSON as agenda-practice-lib.ts scenarioDefinitionSha256: key order and whitespace never matter.
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const defSha = v => sha256(canonical(v));
const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const uniq = xs => [...new Set(xs)];
const sortedUniq = xs => uniq(xs).sort();
/** Leading code of each grader reason ("MISSING Fábio | ..." → MISSING, "UNSAFE DOUBLE_BOOKING ..." → UNSAFE_DOUBLE_BOOKING): never the text after it. */
const failCodes = whys => sortedUniq(whys.map(w => { const p = String(w).split(' '); return p[0] === 'UNSAFE' && /^[A-Z_]+$/.test(p[1] ?? '') ? 'UNSAFE_' + p[1] : p[0]; })
  .filter(w => /^[A-Z][A-Z_]+$/.test(w)));

// ---------------------------------------------------------------- vocabulary
const OPS = ['create', 'change', 'cancel', 'block', 'read'];
const PHENOMENA = ['accents', 'abbreviations', 'spoken numbers', 'voice', 'typo', 'homonym', 'nickname', 'names-as-words', 'interval',
  'day-of-month', 'weekday', 'relative-day', 'negation', 'reference', 'discard', 'out-of-scope'];
const SPLITS = ['dev', 'validation', 'test', 'regression'];
const TAG_PHENOMENA = {
  accents: ['accents'], abbreviations: ['abbreviation'], 'spoken numbers': ['spoken-number', 'time-words'],
  voice: ['voice', 'mode-voice', 'dictated', 'register-audio'], typo: ['typo', 'common-typo'], homonym: ['homonym', 'homonym-professional'],
  nickname: ['nickname'], 'names-as-words': ['word-name', 'name-word', 'name-temporal', 'name-service'], interval: ['interval', 'date-after-interval'],
  'day-of-month': ['day-of-month', 'date-dm', 'date-ddmm', 'date-dia', 'date-dia-dw', 'date-weekday-dia', 'date-weekday-ddmm', 'date-weekday-dia-dw', 'date-combo'],
  weekday: ['weekday', 'date-weekday', 'date-weekdayfull', 'date-weekday-dia', 'date-weekday-ddmm', 'date-weekday-dia-dw', 'date-combo'],
  'relative-day': ['relative-day', 'relative-week', 'date-relative'], negation: ['negation'], reference: ['reference', 'pronoun', 'released-slot'],
  discard: ['discard'], 'out-of-scope': ['communication', 'conversation', 'unsupported', 'out-of-scope'],
};
const TAG_OPS = { create: 'create', reschedule: 'change', cancel: 'cancel', block: 'block', read: 'read', availability: 'read', 'day-agenda': 'read' };
const REGIONAL = /^style-(?!none$)/;

// ---------------------------------------------------------------- text rules (heuristic; every hit is labelled basis "text")
const WB = '(?<![\\p{L}\\p{N}_])', WE = '(?![\\p{L}\\p{N}_])';
const re = body => new RegExp(WB + '(?:' + body + ')' + WE, 'u');
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOUR_SAFE = 'quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte(?: e (?:uma|duas|tres))?|meio[- ]dia|meia[- ]noite';
const HOURW = `uma|duas|tres|${HOUR_SAFE}`;
const DAYW = 'primeiro|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte(?: e (?:um|dois|tres|quatro|cinco|seis|sete|oito|nove))?|trinta(?: e um)?';
const TIME = `\\d{1,2}(?:[:h]\\d{2})?\\s?(?:h|hs|hrs|horas)?|${HOURW}`;
const ACCENTLESS = ['amanha', 'horario', 'horarios', 'sabado', 'sabados', 'terca', 'voce', 'voces', 'ate', 'tambem', 'nao', 'entao', 'proximo', 'proxima', 'manha', 'so', 'ja', 'ta', 'tres', 'mes',
  'apos', 'servico', 'servicos', 'reuniao', 'possivel', 'unico', 'unica', 'ultimo', 'ultima', 'numero', 'audio', 'medico', 'medica', 'cilios', 'estetica'];
const RULES = {
  accents: t => re(ACCENTLESS.join('|')).test(t.raw) || /(?<![\p{L}])\p{L}+(?:cao|coes)(?![\p{L}])/u.test(t.raw),
  abbreviations: t => re('vc|vcs|tb|tbm|pq|hj|amnh|qdo|qnd|qd|msg|obg|pfv|pfvr|pf|blz|td|tds|mt|mto|mta|dps|hr|hrs|q|n|p|vlw|flw|agr|dnv|cmg|ctg|oq|qq|qlq|qqr|fds').test(t.fold) || /\d\s?(?:hs|hrs|hr)(?![\p{L}])/u.test(t.fold),
  'spoken numbers': t => re(`(?:as|das|pras|ate as)\\s+(?:${HOUR_SAFE})`).test(t.fold) || re(`(?:${HOURW})\\s+(?:horas?|e meia|e quinze|e quarenta(?: e cinco)?|da manha|da tarde|da noite)`).test(t.fold) ||
    re(`(?:de|das)\\s+(?:${HOURW})\\s+(?:as|a|ate)\\s+(?:${HOURW})`).test(t.fold) || re('(?:dez|quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa)\\s+minutos').test(t.fold) || re(`dia\\s+(?:${DAYW})`).test(t.fold),
  interval: t => re(`(?:das?|dos?|de|entre)\\s+(?:${TIME})\\s+(?:as|a|ate(?:\\s+as)?|e)\\s+(?:${TIME})`).test(t.fold) ||
    /(?<![\p{N}:])\d{1,2}(?:[:h]\d{2}|h)\s?-\s?\d{1,2}(?:[:h]\d{2}|h)?(?![\p{N}])/u.test(t.fold) ||
    re('a tarde toda|a manha toda|o dia (?:todo|inteiro)|a tarde inteira|a manha inteira|a partir d[ae]s?').test(t.fold),
  'day-of-month': t => re(`dia\\s+(?:\\d{1,2}|${DAYW})`).test(t.fold) || /(?<![\p{N}/])\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?![\p{N}/])/u.test(t.fold) ||
    re(`(?:\\d{1,2}|${DAYW}) de (?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)`).test(t.fold),
  // "domingo" only in the singular ("Domingos" is a first name); a bare "a segunda"/"a quinta" is an ordinal choice
  // ("é a segunda" = the second option), not a weekday.
  weekday: t => re('(?:segunda|terca|quarta|quinta|sexta)(?:s)?-feiras?|terca|quarta|sexta|(?<!(?:^|\\s)a\\s)(?:segunda|quinta)s?|sabados?|domingo').test(t.fold),
  'relative-day': t => re('hoje|amanha|depois de amanha|ontem|semana que vem|proxima semana|semana seguinte|daqui a \\S+ dias?|mes que vem|fim de semana|essa semana|esta semana').test(t.fold),
};
// Negation = a negative word anywhere in the owner's message (an operation, a value, a self-correction or a reason
// clause): the risk being covered is turning any of them into an affirmative operation.
const SAY_RULES = {
  negation: t => re('nao|nunca|nem|n(?=\\s+\\p{L}{2,})').test(t.fold),
  discard: t => re('esquece|esqueca|deixa (?:pra|para) la|deixa quieto|deixa assim|desist\\w*|nao,? deixa|(?:cancela|pode cancelar) (?:o|esse|tudo isso|esse) pedido|melhor nao').test(t.fold),
  reference: t => re('no lugar d\\w*|no mesmo horario|nesse (?:mesmo )?horario|naquele horario|no horario d\\w*|mesmo servico|mesma profissional|mesmo profissional|mesmo dia|nesse dia|neste dia|naquele dia|o outro|a outra').test(t.fold) ||
    re('(?:passa|muda|remarca|desmarca|cancela|coloca|marca|bota|joga|poe|transfere|move|troca|adianta|atrasa)\\s+(?:ela|ele)').test(t.fold) || re('(?:o horario|a vaga|o espaco) (?:dela|dele)').test(t.fold),
};
const FORMAL = re('poderia|gostaria|por gentileza|por obsequio|solicito');
// {{d:<spec>|<format>}} tokens of the practice templates: the format decides the date phenomenon.
const TOKEN = /\{\{\s*d:\s*([^|{}]+?)\s*\|\s*([a-z]+)\s*\}\}/gi;
const TOKEN_PHENOMENA = { dd: ['day-of-month'], d: ['day-of-month'], dm: ['day-of-month'], ddmm: ['day-of-month'], ddmmyyyy: ['day-of-month'], iso: ['day-of-month'],
  dw: ['day-of-month', 'spoken numbers', 'voice'], weekday: ['weekday'], weekdayfull: ['weekday'] };
const textView = s => { const raw = String(s).replace(TOKEN, ' ').toLowerCase(); return { raw, fold: fold(raw) }; };

// ---------------------------------------------------------------- dates (America/Sao_Paulo, same rules as agenda-practice-lib.ts)
const TZ = 'America/Sao_Paulo', DAY_MS = 86_400_000, WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const shortWeekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const dateKey = d => { const p = Object.fromEntries(ymd.formatToParts(d).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const noon = k => Date.parse(`${k}T12:00:00-03:00`);
const addDays = (k, n) => dateKey(new Date(noon(k) + n * DAY_MS));
const weekdayOf = k => WD_EN.indexOf(shortWeekday.format(new Date(noon(k))));
const runToday = id => { const m = typeof id === 'string' ? /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id) : null; return m ? dateKey(new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)) : undefined; };
const LEGACY_CHECK = `${EVAL}/agenda-practice-check.cjs`;
const legacyCode = (() => { let c = null; return () => {
  if (c) return c;
  const src = readText(LEGACY_CHECK).replace(/\r\n/g, '\n'), start = src.indexOf('const A = '), end = src.indexOf('\nconst rows = [];');
  if (start < 0 || end < start) throw Error('CATALOG_LEGACY_ORACLE_SHAPE');
  return (c = src.slice(start, end));
}; })();
const legacyCache = new Map();
/** The frozen E map of agenda-practice-check.cjs rendered for a run day (same as legacyOracle in agenda-practice-lib.ts). */
function legacyOracle(today) {
  if (!legacyCache.has(today)) {
    let fri = 1; while (weekdayOf(addDays(today, fri)) !== 5) fri++;
    const E = vm.runInNewContext(`${legacyCode()}\n;E`, { day: n => addDays(today, n), fri, thu: fri - 1 }, { timeout: 1000 });
    legacyCache.set(today, JSON.parse(JSON.stringify(E)));
  }
  return legacyCache.get(today);
}
function legacyScore(e, initial, last) {
  const why = [];
  if (!e) why.push('NO_ORACLE');
  else if (e.none) { if (JSON.stringify(last.appointments) !== JSON.stringify(initial.appointments) || last.blocks.length) why.push('UNEXPECTED_DB_CHANGE'); }
  else {
    for (const parts of e.has ?? []) if (!last.appointments.some(a => parts.every(p => a.includes(p)))) why.push('MISSING');
    for (const b of e.blocks ?? []) if (!last.blocks.some(x => x.startsWith(b))) why.push('MISSING_BLOCK');
  }
  return { ok: !why.length, why };
}

// ---------------------------------------------------------------- scenario people and oracle-derived operations
const BASE = {
  customers: [['amanda', 'Amanda Souza'], ['joao', 'João Pereira'], ['fabio', 'Fábio Santos'], ['carla', 'Carla Mendes'], ['rosa', 'Rosa Viana']],
  professionals: [['tatiana', 'Tatiana Rocha'], ['ricardo', 'Ricardo Alves']],
  services: [['corte', 'Corte Completo'], ['escova', 'Escova'], ['barba', 'Barba'], ['coloracao', 'Coloração']],
};
const slug = name => { const k = fold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return /^[a-z]/.test(k) ? k : 'x_' + k; };
const uniqueKey = (key, used) => { let k = key, n = 2; while (used.has(k)) k = `${key}_${n++}`; used.add(k); return k; };
function people(s) {
  const salon = s.salon, customers = new Map(salon ? [] : BASE.customers), pros = new Map(salon ? [] : BASE.professionals);
  const services = new Map(salon ? [] : BASE.services);
  const ck = new Set(customers.keys()), pk = new Set(pros.keys());
  for (const c of s.customers ?? []) customers.set(c.key ?? uniqueKey(slug(c.name), ck), c.name);
  for (const p of s.professionals ?? []) pros.set(p.key ?? uniqueKey(slug(p.name), pk), p.name);
  if (salon) { const used = new Set(salon.services.flatMap(x => x.key ? [x.key] : [])); for (const x of salon.services) services.set(x.key ?? uniqueKey(slug(x.name), used), x.name); }
  return { customers, pros, services };
}
const daySig = spec => {
  if (typeof spec === 'number') return 'n:' + spec;
  const n = /^\s*([+-]?\d{1,4})\s*$/.exec(String(spec)); if (n) return 'n:' + Number(n[1]);
  const m = /^\s*(\p{L}+(?:-feira)?)\s*(?:([+-])\s*(\d{1,3}))?\s*$/u.exec(String(spec));
  return m ? 'w:' + fold(m[1]).slice(0, 3) + (m[2] ? m[2] + Number(m[3]) : '') : 's:' + spec;
};
/** Net effect of an exact `final` oracle against the seeded appointments: cancel / change / create per row, block per block. */
function finalOps(s) {
  const f = s.final; if (!f || f.unchanged) return [];
  const pp = people(s), seeds = (s.appointments ?? []).map(a => ({ customer: pp.customers.get(a.customer) ?? a.customer, service: pp.services.get(a.service) ?? a.service,
    professional: pp.pros.get(a.professional) ?? a.professional, day: daySig(a.day), time: a.time, used: false }));
  const finals = (f.appointments ?? []).map(a => ({ ...a, day: daySig(a.day), status: a.status ?? 'CONFIRMED', done: false })), ops = [];
  const take = pred => { const x = seeds.find(z => !z.used && pred(z)); if (x) x.used = true; return !!x; };
  for (const a of finals.filter(x => x.status === 'CANCELLED')) {
    a.done = true; ops.push('cancel');
    if (!take(z => z.customer === a.customer && z.day === a.day && z.time === a.time)) take(z => z.customer === a.customer);
  }
  for (const a of finals.filter(x => !x.done)) if (take(z => z.customer === a.customer && z.service === a.service && z.day === a.day && z.time === a.time &&
    (a.professional === undefined || z.professional === a.professional))) a.done = true;
  for (const a of finals.filter(x => !x.done)) { a.done = true; ops.push(take(z => z.customer === a.customer) ? 'change' : 'create'); }
  for (let i = 0; i < (f.blocks ?? []).length; i++) ops.push('block');
  return ops;
}
/** Net effect of a legacy E expectation (A/B/C have no `final`). */
function legacyOps(s, e) {
  if (!e || e.none) return [];
  const pp = people(s), seeds = (s.appointments ?? []).map(a => ({ customer: pp.customers.get(a.customer) ?? a.customer, used: false })), ops = [];
  for (const parts of e.has ?? []) {
    const who = String(parts[0]).split(' | ')[0], seed = seeds.find(z => !z.used && z.customer === who);
    if (parts.some(p => String(p).includes('CANCELLED'))) { if (seed) seed.used = true; ops.push('cancel'); continue; }
    if (seed) { seed.used = true; ops.push('change'); } else ops.push('create');
  }
  for (let i = 0; i < (e.blocks ?? []).length; i++) ops.push('block');
  return ops;
}
const answerInstances = spec => spec && typeof spec === 'object' && !Array.isArray(spec) ? spec.queue : [spec];
function messagesOf(s) {
  const say = s.steps.filter(x => typeof x.say === 'string').map(x => x.say);
  const answers = Object.values(s.answers ?? {}).flatMap(spec => answerInstances(spec).flatMap(v => Array.isArray(v) ? v : [v]));
  return { say, answers };
}
/** Same-role people sharing a first name (or a full name) that a message names without the full name. */
function homonymMentioned(groups, texts) {
  const words = texts.map(t => fold(t));
  for (const names of groups) {
    const byFirst = new Map();
    for (const n of names) { const first = fold(n).split(/\s+/)[0]; if (!byFirst.has(first)) byFirst.set(first, []); byFirst.get(first).push(fold(n)); }
    for (const [first, full] of byFirst) if (full.length > 1 && words.some(w => re(escapeRe(first)).test(w) && (new Set(full).size === 1 || !full.some(n => w.includes(n))))) return true;
  }
  return false;
}
/** Names with diacritics written without them (the fixture spells "Fábio", the message says "fabio"). */
function namesAccentless(names, texts) {
  const tokens = uniq(names.flatMap(n => String(n).split(/\s+/)).filter(w => fold(w) !== w.toLowerCase()));
  return texts.some(t => { const low = String(t).replace(TOKEN, ' ').toLowerCase(); return tokens.some(w => re(escapeRe(fold(w))).test(low) && !low.includes(w.toLowerCase())); });
}

function phenomenaOf({ tags, say, answers, structure, peopleGroups, names }) {
  const basis = {}, add = (p, b) => { (basis[p] ??= new Set()).add(b); };
  for (const [p, list] of Object.entries(TAG_PHENOMENA)) if (tags.some(t => list.includes(t))) add(p, 'tag');
  const all = [...say, ...answers];
  for (const text of all) for (const m of String(text).matchAll(TOKEN)) for (const p of TOKEN_PHENOMENA[m[2].toLowerCase()] ?? []) add(p, 'template');
  const views = all.map(textView), sayViews = say.map(textView);
  for (const [p, rule] of Object.entries(RULES)) if (views.some(rule)) add(p, 'text');
  for (const [p, rule] of Object.entries(SAY_RULES)) if (sayViews.some(rule)) add(p, 'text');
  if (names?.length && namesAccentless(names, all)) add('accents', 'structure');
  if (peopleGroups?.length && homonymMentioned(peopleGroups, say)) add('homonym', 'structure');
  for (const p of structure ?? []) add(p, 'structure');
  const phenomena = PHENOMENA.filter(p => basis[p]);
  return { phenomena, basis: Object.fromEntries(phenomena.map(p => [p, [...basis[p]].sort()])) };
}
function styleOf(tags, phenomena, say) {
  const style = [phenomena.includes('voice') ? 'voice' : 'typing'];
  if (tags.includes('register-formal') || say.some(t => FORMAL.test(fold(t)))) style.push('formal');
  if (tags.some(t => REGIONAL.test(t) || t === 'regional')) style.push('regional');
  return style;
}

// ---------------------------------------------------------------- oracle provenance (second annotations written by other workflows)
function annotationIndex() {
  const dir = '.demo/agenda-core/oracle-audit', out = { blind: new Map(), adjudicated: new Map(), files: [] };
  if (!exists(dir)) return out;
  for (const f of fs.readdirSync(abs(dir)).filter(f => f.endsWith('.json') && f !== path.basename(OUT.audit)).sort()) {
    const rel = `${dir}/${f}`, kind = /adjudicat/i.test(f) ? 'adjudicated' : /annotator|annotation/i.test(f) ? 'blind' : null;
    if (!kind) { out.files.push({ file: rel, kind: 'ignored' }); continue; }
    let j; try { j = readJson(rel); } catch { out.files.push({ file: rel, kind, status: 'UNPARSEABLE' }); continue; }
    const cases = Array.isArray(j) ? j : Array.isArray(j?.cases) ? j.cases : [];
    const ids = cases.map(c => c?.id).filter(id => typeof id === 'string'), label = typeof j?.annotator === 'string' ? j.annotator : f.replace(/\.json$/, '');
    for (const id of ids) { const m = out[kind]; if (!m.has(id)) m.set(id, []); m.get(id).push(label); }
    out.files.push({ file: rel, kind, annotator: label, cases: ids.length, sha256: sha256(readBytes(rel)) });
  }
  return out;
}

// ---------------------------------------------------------------- sources
const DEV_SOURCES = [
  { file: `${EVAL}/agenda-practice-variations.json`, battery: 'V', source: 'assistant', split: 'dev', status: 'active', oracle: 'final' },
  { file: `${EVAL}/agenda-practice-natural.json`, battery: 'N', source: 'assistant', split: 'dev', status: 'active', oracle: 'final' },
  { file: `${EVAL}/agenda-practice-scenarios.json`, battery: 'A', source: 'legacy', split: 'regression', status: 'regression', oracle: 'legacy-E-map' },
  { file: `${EVAL}/agenda-practice-scenarios-r2.json`, battery: 'B', source: 'legacy', split: 'regression', status: 'regression', oracle: 'legacy-E-map' },
  { file: `${EVAL}/agenda-practice-scenarios-r3.json`, battery: 'C', source: 'legacy', split: 'regression', status: 'regression', oracle: 'legacy-E-map' },
  { file: `${EVAL}/multi-salon/generated-dev.json`, battery: 'MD', source: 'generated', split: 'dev', status: 'active', oracle: 'final', optional: true },
];
const GOLDEN = { json: `${EVAL}/free-use-golden-30.json`, ts: `${EVAL}/free-use-golden.ts`, doc: 'docs/SECRETARY_GOLDEN_FREE_USE_30.md' };
const REGISTRY = `${EVAL}/holdout-registry.json`;
/** Public, non-sealed statements of each registered set (case counts are declared by the docs, never read from the file). */
const DECLARED = {
  'assistant-v1': { source: 'assistant', cases: 26, doc: 'docs/SECRETARY_HOLDOUT_PROTOCOL.md', proof: 'a7c4d447f5d042f3cdf3139ae7eca149d290882482853e57c3a2bd084c201b29',
    note: 'assistant holdout v1b (v1 superseded before any run); same author family and style as the DEV batteries' },
  'owner-v1': { source: 'owner', cases: 30, doc: 'docs/SECRETARY_HOLDOUT_PROTOCOL.md', proof: '75a3121e1f4ed3251840f1f7a8b5aa0c51791a4cabdd48fdd662612b2d544b69',
    note: 'owner-written messages (plain text); structured oracle still to be written (R13: two isolated annotators + owner adjudication)' },
  'owner-multi-v1': { source: 'owner', cases: 30, doc: 'docs/SECRETARY_HOLDOUT_PROTOCOL.md', proof: 'bd8c6797232cbffba2649407e96b5fbe9be7cc8b2b41ccb55a79c6020e25de00',
    note: 'owner-written multi-action requests (plain text); structured oracle still to be written (R13)' },
  'validation-v1': { source: 'assistant', cases: 30, doc: 'docs/SECRETARY_EVALUATION_METHODOLOGY.md', proof: '42cb4c1628b15bcbca413dea1cb4204bf250258051d4c3f85da285ca1baf6a4c',
    note: 'single author (an agent of the same program), no second oracle reviewer; the methodology asks for a v2 before the first run' },
};
const RESULTS = `${EVAL}/results/agenda-core`, GOLDEN_RESULTS = `${EVAL}/results/free-use`;
const MARKERS = ['sealed-run.json', 'validation-run.json'];

function build() {
  const annotations = annotationIndex(), sources = [], cases = [], byId = new Map(), audit = { schema: 'secretary-eval-catalog-crosschecks-v1', sources: [], runs: [], definitionDrift: [],
    legacyRegrade: [], golden: {}, tagAgreement: {}, annotations: annotations.files, skippedRuns: [] };
  const legacyE = legacyOracle('2026-09-27'); // ops only (dates irrelevant)

  // ---- per-case sources: V, N, A/B/C, MD
  for (const src of DEV_SOURCES) {
    if (!exists(src.file)) { if (src.optional) { sources.push({ path: src.file, present: false }); continue; } throw Error('CATALOG_SOURCE_MISSING:' + src.file); }
    const bytes = readBytes(src.file), list = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    let manifest = null;
    if (src.battery === 'MD') {
      const mf = `${EVAL}/multi-salon/generated-dev.manifest.json`;
      if (exists(mf)) { const m = readJson(mf); manifest = { sha256Matches: m.sha256 === sha256(bytes), generator: m.generator, seed: m.seed, byId: new Map((m.scenarios ?? []).map(x => [x.id, x])) }; }
    }
    sources.push({ path: src.file, present: true, sha256: sha256(bytes), battery: src.battery, cases: list.length, split: src.split, source: src.source,
      ...(manifest ? { manifestSha256Matches: manifest.sha256Matches, generator: manifest.generator, seed: manifest.seed } : {}) });
    for (const s of list) {
      const tags = [...(s.capability ?? [])], { say, answers } = messagesOf(s), pp = people(s);
      const structure = [];
      const discard = !!s.final?.noPendingPlan || s.steps.some(x => x.expectError === 'NOTHING_TO_CONFIRM');
      if (discard) structure.push('discard');
      const readStep = s.steps.some(x => x.expect === 'READ_DONE');
      const net = src.oracle === 'final' ? finalOps(s) : legacyOps(s, legacyE[s.id]); // writes the oracle expects
      const tagOps = sortedUniq(tags.map(t => TAG_OPS[t]).filter(Boolean));
      // Exercised operations: the oracle's writes, a READ_DONE step, plus the author's operation tags, because negation,
      // discard and a conflict the Secretary must not write end without a write, and the legacy E map only shows the end.
      const operations = OPS.filter(o => net.includes(o) || tagOps.includes(o) || (o === 'read' && readStep));
      const opBasis = Object.fromEntries(operations.map(o => [o, [...(net.includes(o) ? ['oracle'] : []), ...(tagOps.includes(o) ? ['tag'] : []), ...(o === 'read' && readStep ? ['step'] : [])]]));
      const actionCount = Math.max(net.length + (operations.includes('read') ? 1 : 0), operations.length);
      const meta = manifest?.byId.get(s.id);
      const peopleGroups = [[...pp.customers.values()], [...pp.pros.values()]];
      const ph = phenomenaOf({ tags, say, answers, structure, peopleGroups, names: [...pp.customers.values(), ...pp.pros.values(), ...pp.services.values()] });
      const blind = annotations.blind.get(s.id) ?? [], adjudicated = annotations.adjudicated.get(s.id) ?? [];
      const entry = {
        id: s.id, battery: src.battery, source: src.source, split: src.split, status: src.status,
        salon_type: s.salon ? (s.salon.type ?? 'custom') : 'base-fixture',
        operations, operations_net: sortedUniq(net), operations_basis: opBasis, action_count: actionCount,
        phenomena: ph.phenomena, phenomena_basis: ph.basis, capability_tags: tags, style: styleOf(tags, ph.phenomena, say),
        oracle_kind: src.oracle, oracle_provenance: adjudicated.length ? 'adjudicated' : blind.length ? 'double-annotated' : 'single-author',
        ...(blind.length || adjudicated.length ? { oracle_annotations: { blind: sortedUniq(blind), adjudicated: sortedUniq(adjudicated) } } : {}),
        sha256: defSha(s), sha256_scope: 'case', source_file: src.file,
        messages: { say: say.length, answer_variants: answers.length },
        ...(meta ? { generator_meta: { template: meta.template, mode: meta.mode, region: meta.region, register: meta.register, dateForm: meta.dateForm, timeStyle: meta.timeStyle } } : {}),
        results_history: [], notes: [],
      };
      if (src.oracle === 'legacy-E-map' && !legacyE[s.id]) entry.notes.push('NO_LEGACY_ORACLE');
      if (s.final?.mustAsk) entry.notes.push('TRANSCRIPT_ORACLE:mustAsk');
      if (s.final?.noPendingPlan) entry.notes.push('TRANSCRIPT_ORACLE:noPendingPlan');
      if (/alvo do dono/i.test(s.title ?? '')) entry.notes.push('OWNER_TARGET_SENTENCE (written by the assistant from the owner goal)');
      if (src.battery === 'MD') entry.notes.push('PROGRAM_GENERATED_ORACLE (templates.ts planner)');
      if (byId.has(s.id)) throw Error('CATALOG_DUPLICATE_ID:' + s.id);
      byId.set(s.id, entry); cases.push(entry);
    }
  }

  // ---- Golden 30 (regression): ids from free-use-golden.ts, definitions from its materialized JSON
  {
    const gj = readJson(GOLDEN.json), tsIds = sortedUniq([...readText(GOLDEN.ts).matchAll(/^\s{2}(GF\d{2}):\[/gm)].map(m => m[1]));
    const docSha = sha256(readBytes(GOLDEN.doc)), ids = gj.cases.map(c => c.id);
    audit.golden.source = { docSha256: docSha, jsonSourceSha256: gj.source.sha256, docMatchesJson: docSha === gj.source.sha256, tsIds: tsIds.length,
      idsMatch: tsIds.join() === [...ids].sort().join() };
    sources.push({ path: GOLDEN.json, present: true, sha256: sha256(readBytes(GOLDEN.json)), battery: 'GF', cases: ids.length, split: 'regression', source: 'assistant',
      docSha256Matches: docSha === gj.source.sha256, tsIdsMatch: audit.golden.source.idsMatch });
    const fixtureNames = [...gj.fixture.customers.map(c => c.name), ...gj.fixture.professionals.map(p => p.name), ...gj.fixture.services.map(x => x.name), ...(gj.fixture.products ?? []).map(x => x.name)];
    for (const c of gj.cases) {
      if (!tsIds.includes(c.id)) throw Error('CATALOG_GOLDEN_ID_UNKNOWN:' + c.id);
      const say = c.turns.map(t => t.message), acts = c.turns.flatMap(t => t.expect?.actions ?? []), forbid = c.turns.flatMap(t => t.expect?.forbidOperations ?? []);
      const opNames = sortedUniq(acts.map(a => a.operation).filter(o => o && !forbid.includes(o)));
      const MAP = { 'appointment.create': 'create', 'appointment.change': 'change', 'appointment.cancel': 'cancel', 'appointment.read': 'read', 'appointment.list': 'read', 'availability.get': 'read' };
      const operations = OPS.filter(o => opNames.some(n => MAP[n] === o)), other = opNames.filter(n => !MAP[n]);
      const unsupported = c.turns.some(t => t.expect?.capabilityStatus === 'UNSUPPORTED');
      const fixture = c.fixture ?? gj.fixture;
      const ph = phenomenaOf({ tags: [], say, answers: [], structure: unsupported ? ['out-of-scope'] : [], names: fixtureNames,
        peopleGroups: [fixture.customers.map(x => x.name), fixture.professionals.map(x => x.name)] });
      const blind = annotations.blind.get(c.id) ?? [], adjudicated = annotations.adjudicated.get(c.id) ?? [];
      const entry = { id: c.id, battery: 'GF', source: 'assistant', split: 'regression', status: 'regression', salon_type: 'golden-fixture',
        operations, operations_net: operations, operations_basis: Object.fromEntries(operations.map(o => [o, ['oracle']])), other_operations: other,
        action_count: Math.max(0, ...c.turns.map(t => t.expect?.actionCount ?? 0)),
        phenomena: ph.phenomena, phenomena_basis: ph.basis, capability_tags: [], family: c.family, style: styleOf([], ph.phenomena, say),
        oracle_kind: 'golden-contract', oracle_provenance: adjudicated.length ? 'adjudicated' : blind.length ? 'double-annotated' : 'single-author',
        sha256: defSha(c), sha256_scope: 'case', source_file: GOLDEN.json, messages: { say: say.length, answer_variants: 0 },
        results_history: [], notes: ['REGRESSION_ONLY (methodology R11: never a quality score)'] };
      byId.set(c.id, entry); cases.push(entry);
    }
  }

  // ---- sealed / validation sets: registry ids + sha only
  const registry = readJson(REGISTRY);
  sources.push({ path: REGISTRY, present: true, sha256: sha256(readBytes(REGISTRY)), battery: 'registry', holdouts: registry.holdouts.length });
  for (const h of registry.holdouts) {
    const d = DECLARED[h.id], split = h.retired ? 'regression' : h.kind === 'validation' ? 'validation' : 'test';
    const docOk = d ? readText(d.doc).includes(d.proof) : false;
    const approved = h.approved.map(a => ({ sha256: a.sha256, ids_registered: Array.isArray(a.ids) ? a.ids.length : null }));
    const entry = { id: `holdout:${h.id}`, battery: 'registry', source: d?.source ?? 'unknown', split, status: h.retired ? 'regression' : h.looks.length ? 'consumed' : 'active',
      salon_type: null, operations: null, action_count: null, phenomena: null, style: null, oracle_provenance: null, oracle_kind: null,
      sha256: approved[0]?.sha256 ?? h.source.sha256, sha256_scope: 'file',
      registry: { kind: h.kind, retired: h.retired, source_name: h.source.name, source_sha256: h.source.sha256, approved, looks: h.looks.length },
      case_ids: approved.some(a => a.ids_registered) ? h.approved.flatMap(a => a.ids ?? []) : null,
      declared_cases: d?.cases ?? null, declared_in: d ? d.doc : null, declared_doc_mentions_sha: docOk,
      results_history: [], notes: [...(d ? [d.note] : ['NOT_DECLARED_IN_DOCS']), 'CONTENTS_NEVER_READ (ids/sha from the registry only; no per-case metadata)'] };
    cases.push(entry); byId.set(entry.id, entry);
  }

  // ---- run results under results/agenda-core
  const runs = [], turnSets = Object.fromEntries(SPLITS.map(s => [s, new Set()]));
  const runDirs = exists(RESULTS) ? fs.readdirSync(abs(RESULTS)).filter(d => fs.statSync(abs(`${RESULTS}/${d}`)).isDirectory()).sort() : [];
  for (const d of runDirs) {
    const dir = `${RESULTS}/${d}`, names = fs.readdirSync(abs(dir));
    if (MARKERS.some(m => names.includes(m))) { audit.skippedRuns.push({ run: d, reason: 'SEALED_OR_VALIDATION_MARKER' }); continue; }
    const attemptDirs = names.filter(n => /^k\d+$/.test(n) && fs.statSync(abs(`${dir}/${n}`)).isDirectory()).map(n => ({ k: Number(n.slice(1)), dir: `${dir}/${n}` })).sort((a, b) => a.k - b.k);
    const flat = !attemptDirs.length, attempts = flat ? [{ k: 1, dir }] : attemptDirs;
    const passk = names.includes('passk.json') ? readJson(`${dir}/passk.json`) : null;
    const report = names.includes('report.json') ? readJson(`${dir}/report.json`) : null;
    // Id gate BEFORE reading any result file: every id must be a catalog case (a holdout copy would carry unknown ids).
    const listedIds = uniq(attempts.flatMap(a => {
      const idx = `${a.dir}/index.jsonl`, fromIndex = exists(idx) ? readText(idx).split('\n').filter(Boolean).map(l => JSON.parse(l).id) : [];
      const fromFiles = fs.readdirSync(abs(a.dir)).filter(f => /^[A-Za-z][A-Za-z0-9_-]*\.json$/.test(f) && !['report.json', 'passk.json'].includes(f)).map(f => f.replace(/\.json$/, ''));
      return [...fromIndex, ...fromFiles];
    }).concat(passk ? passk.scenarios.map(s => s.id) : []));
    const unknown = listedIds.filter(id => !byId.has(id) || byId.get(id).battery === 'registry');
    if (unknown.length) { audit.skippedRuns.push({ run: d, reason: 'UNKNOWN_SCENARIO_IDS', count: unknown.length }); continue; }
    if (!passk && !flat) { audit.skippedRuns.push({ run: d, reason: 'NO_PASSK_JSON' }); continue; }
    const label = d.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-?/, '') || d, date = d.slice(0, 10);
    const per = new Map(); let turns = 0, calls = 0, files = 0;
    for (const a of attempts) for (const f of fs.readdirSync(abs(a.dir)).filter(f => /^[A-Za-z][A-Za-z0-9_-]*\.json$/.test(f) && !['report.json', 'passk.json'].includes(f)).sort()) {
      const r = readJson(`${a.dir}/${f}`); if (!r?.scenario?.id || !Array.isArray(r.transcript)) continue;
      files++;
      const id = r.scenario.id, e = byId.get(id), rows = r.transcript.filter(t => t.note === undefined && (t.action === 'say' || String(t.action).startsWith('answer')));
      const t = rows.length, c = r.transcript.reduce((n, x) => n + (x.calls ?? 0), 0);
      turns += t; calls += c;
      for (const x of rows) if (typeof x.input === 'string') turnSets[e.split].add(sha256(x.input));
      const rec = per.get(id) ?? { attempts: [], definitions: new Set() };
      rec.definitions.add(defSha(r.scenario));
      let ok = null, why = [];
      if (!passk) { // legacy flat run: regrade with the frozen E map for the run's day
        const today = r.today ?? runToday(report?.run) ?? runToday(d), last = r.transcript.filter(x => x.db).at(-1)?.db ?? { appointments: [], blocks: [] };
        const g = r.complete === false ? { ok: false, why: ['INCOMPLETE'] } : legacyScore(legacyOracle(today)[id], r.initial, last); ok = g.ok; why = g.why;
      }
      rec.attempts.push({ k: a.k, ok, why, noise: r.noise?.level ?? 'off', turns: t, calls: c, complete: r.complete !== false });
      per.set(id, rec);
    }
    const summary = { run: label, run_dir: d, date, evidence: passk ? 'passk.json' : 'recomputed:legacy-E-map', stage: passk?.stage ?? report?.stage?.name ?? (passk ? null : 'agenda-core-20260927'),
      repeat: passk ? passk.repeat : Math.max(1, ...attempts.map(a => a.k)), valid: passk ? passk.valid : null, status: passk?.status ?? null,
      scenarios: per.size, graded_attempts: files, turns, model_calls: calls, passk_turns: passk?.turns?.count ?? null, passk_graded: passk?.coverage?.graded ?? null };
    runs.push(summary);
    audit.runs.push({ run: d, evidence: summary.evidence, attemptFiles: files, transcriptTurns: turns, passkTurns: summary.passk_turns, turnsMatch: passk ? passk.turns.count === turns : null,
      passkGraded: summary.passk_graded, gradedMatch: passk ? passk.coverage.graded === files : null });
    for (const id of sortedUniq([...per.keys(), ...(passk ? passk.scenarios.map(s => s.id) : [])])) {
      const e = byId.get(id), ps = passk?.scenarios.find(s => s.id === id), rec = per.get(id) ?? { attempts: [], definitions: new Set() };
      const atts = rec.attempts.sort((a, b) => a.k - b.k).map(a => {
        const pa = ps?.attempts.find(x => x.k === a.k);
        return { k: a.k, ok: ps ? !!pa?.ok : a.ok, noise: pa?.noise ?? a.noise, turns: a.turns, calls: a.calls, fail: failCodes(ps ? pa?.why ?? [] : a.why), safety: sortedUniq(pa?.safety ?? []) };
      });
      const defs = [...rec.definitions], matches = !defs.length ? (ps?.definition ? ps.definition === e.sha256 : null) : defs.length === 1 && defs[0] === e.sha256;
      if (matches === false) audit.definitionDrift.push({ run: d, id, recorded: defs.map(x => x.slice(0, 12)), current: e.sha256.slice(0, 12) });
      const n = ps ? ps.n : atts.length, c = ps ? ps.c : atts.filter(a => a.ok).length;
      e.results_history.push({ run: label, run_dir: d, evidence: summary.evidence, k: summary.repeat, c, n, turns: atts.reduce((s, a) => s + a.turns, 0),
        model_calls: atts.reduce((s, a) => s + a.calls, 0), definition_matches_current: matches, run_valid: summary.valid, attempts: atts });
    }
    if (!passk) {
      const tally = { run: d, today: runToday(report?.run) ?? runToday(d), passed: 0, graded: 0 };
      for (const [, rec] of per) for (const a of rec.attempts) { tally.graded++; if (a.ok) tally.passed++; }
      audit.legacyRegrade.push(tally);
    }
  }

  // ---- Golden runs (results/free-use/golden-*: real-model runs of the regression suite)
  const goldenCurrent = new Map(cases.filter(c => c.battery === 'GF').map(c => [c.id, c.sha256]));
  // Chronological: by the date in the name, then the numeric version (v2 before v10).
  const goldenOrder = d => { const m = /^golden-(\d{8})-.*?-v(\d+)$/.exec(d); return m ? [m[1], Number(m[2])] : [d, 0]; };
  const goldenRuns = exists(GOLDEN_RESULTS) ? fs.readdirSync(abs(GOLDEN_RESULTS)).filter(d => /^golden-/.test(d) && fs.statSync(abs(`${GOLDEN_RESULTS}/${d}`)).isDirectory())
    .sort((a, b) => { const x = goldenOrder(a), y = goldenOrder(b); return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]; }) : [];
  audit.golden.runs = [];
  for (const d of goldenRuns) {
    const dir = `${GOLDEN_RESULTS}/${d}`, names = fs.readdirSync(abs(dir));
    if (MARKERS.some(m => names.includes(m))) { audit.skippedRuns.push({ run: d, reason: 'SEALED_OR_VALIDATION_MARKER' }); continue; }
    if (!names.includes('results.json')) { audit.golden.runs.push({ run: d, status: 'NO_RESULTS' }); continue; }
    const r = readJson(`${dir}/results.json`), m = names.includes('manifest.json') ? readJson(`${dir}/manifest.json`) : null;
    if (r.suite !== 'golden-free-use-30' || r.cases.some(c => !goldenCurrent.has(c.id))) { audit.skippedRuns.push({ run: d, reason: 'UNKNOWN_SUITE_OR_IDS' }); continue; }
    const recorded = new Map((m?.suite?.cases ?? []).map(c => [c.id, defSha(c)]));
    let turns = 0; const label = d.replace(/^golden-/, '');
    for (const c of r.cases) {
      const e = byId.get(c.id), observed = (c.turns ?? []).filter(t => t.observation !== undefined);
      turns += observed.length;
      for (const t of observed) if (typeof t.message === 'string') turnSets.regression.add(sha256(t.message));
      const executed = c.status !== 'NOT_EXECUTED', matches = recorded.has(c.id) ? recorded.get(c.id) === e.sha256 : null;
      if (matches === false) audit.definitionDrift.push({ run: d, id: c.id, recorded: [recorded.get(c.id).slice(0, 12)], current: e.sha256.slice(0, 12) });
      e.results_history.push({ run: label, run_dir: d, evidence: 'free-use results.json', k: 1, c: c.status === 'PASS' ? 1 : 0, n: executed ? 1 : 0, status: c.status,
        turns: observed.length, model_calls: null, definition_matches_current: matches, run_valid: r.stopped === null && r.summary?.executed === r.summary?.total,
        attempts: executed ? [{ k: 1, ok: c.status === 'PASS', noise: 'off', turns: observed.length, calls: null, fail: failCodes((c.turns ?? []).map(t => t.reason ?? '')), safety: [] }] : [] });
    }
    const s = r.summary ?? {};
    runs.push({ run: label, run_dir: d, date: null, evidence: 'free-use results.json', stage: 'golden-free-use-30', repeat: 1, valid: r.stopped === null && s.executed === s.total,
      status: r.stopped ?? 'COMPLETE', scenarios: r.cases.length, graded_attempts: s.executed ?? null, turns, model_calls: r.providerEvidence?.requests ?? null, passk_turns: null, passk_graded: null });
    audit.golden.runs.push({ run: d, pass: s.pass, total: s.total, executed: s.executed, stopped: r.stopped, observedTurns: turns, summaryObservedTurns: s.metricCoverage?.observedTurns ?? null,
      turnsMatch: s.metricCoverage ? s.metricCoverage.observedTurns === turns : null, passMatch: r.cases.filter(c => c.status === 'PASS').length === s.pass,
      providerRequests: r.providerEvidence?.requests ?? null, model: r.model ?? null });
  }

  // ---- per-case rollups
  for (const e of cases) {
    e.graded = { runs: e.results_history.length, attempts: e.results_history.reduce((n, h) => n + h.n, 0), passed: e.results_history.reduce((n, h) => n + h.c, 0),
      turns: e.results_history.reduce((n, h) => n + h.turns, 0) };
    // Latest graded run on the CURRENT definition (history is chronological within each evidence family).
    const last = e.results_history.filter(h => h.definition_matches_current !== false && h.n > 0).at(-1);
    e.latest = last ? { run: last.run, evidence: last.evidence, c: last.c, n: last.n } : null;
  }

  // ---- tag vs text agreement (oracle audit of the phenomenon labels)
  for (const p of PHENOMENA) {
    const withTag = cases.filter(c => c.phenomena_basis?.[p]?.includes('tag')), withText = cases.filter(c => c.phenomena_basis?.[p]?.some(b => b !== 'tag'));
    audit.tagAgreement[p] = { tag: withTag.length, textOrStructure: withText.length, both: withTag.filter(c => withText.includes(c)).length,
      tagOnly: withTag.filter(c => !withText.includes(c)).map(c => c.id), detectedOnly: withText.filter(c => !withTag.includes(c)).length };
  }
  audit.sources = sources;
  return { sources, cases, runs, audit, turnSets, annotations };
}

// ---------------------------------------------------------------- matrix, gaps and totals
/** Matrix columns of a case: its Agenda operations, else "(other)" (Golden service/customer/stock/financial only), else "(none)". */
const opColumns = c => c.operations.length ? c.operations : c.other_operations?.length ? ['(other)'] : ['(none)'];
function matrix(cases) {
  const cells = new Map(), key = (o, p, s) => `${o}\u0000${p}\u0000${s}`;
  for (const c of cases.filter(x => x.operations)) for (const o of opColumns(c)) for (const p of c.phenomena.length ? c.phenomena : ['(none)']) {
    for (const s of [c.salon_type, '*']) { const k = key(o, p, s); const v = cells.get(k) ?? Object.fromEntries(SPLITS.map(x => [x, 0])); v[c.split]++; cells.set(k, v); }
  }
  const get = (o, p, s) => cells.get(key(o, p, s)) ?? Object.fromEntries(SPLITS.map(x => [x, 0]));
  return { get };
}
function totals(built) {
  const { cases, runs, turnSets } = built, per = {};
  for (const split of SPLITS) {
    const list = cases.filter(c => c.split === split && c.battery !== 'registry'), reg = cases.filter(c => c.split === split && c.battery === 'registry');
    const hist = list.flatMap(c => c.results_history);
    per[split] = { cases: list.length, distinct_definitions: new Set(list.map(c => c.sha256)).size, registry_sets: reg.length,
      declared_sealed_cases: reg.reduce((n, c) => n + (c.declared_cases ?? 0), 0), authored_messages: list.reduce((n, c) => n + (c.messages?.say ?? 0), 0),
      answer_variants: list.reduce((n, c) => n + (c.messages?.answer_variants ?? 0), 0), graded_attempts: hist.reduce((n, h) => n + h.n, 0),
      passed_attempts: hist.reduce((n, h) => n + h.c, 0), luna_turns: hist.reduce((n, h) => n + h.turns, 0), distinct_sent_texts: turnSets[split].size,
      cases_ever_graded: list.filter(c => c.results_history.some(h => h.n > 0)).length };
  }
  const byEvidence = {};
  for (const r of runs) { const b = byEvidence[r.evidence] ??= { runs: 0, turns: 0, graded_attempts: 0 }; b.runs++; b.turns += r.turns; b.graded_attempts += r.graded_attempts ?? 0; }
  const all = { luna_turns: runs.reduce((n, r) => n + r.turns, 0), model_calls_agenda_core: runs.filter(r => r.evidence !== 'free-use results.json').reduce((n, r) => n + (r.model_calls ?? 0), 0),
    provider_requests_golden: runs.filter(r => r.evidence === 'free-use results.json').reduce((n, r) => n + (r.model_calls ?? 0), 0),
    distinct_sent_texts: new Set(SPLITS.flatMap(s => [...turnSets[s]])).size, runs: runs.length, byEvidence };
  return { per, all };
}

// ---------------------------------------------------------------- coverage.md
const pct = (c, n) => n ? `${Math.round(100 * c / n)}%` : '-';
function coverageMd(built, tot) {
  const { cases, runs, audit } = built, m = matrix(cases), perCase = cases.filter(c => c.operations);
  const devTypes = sortedUniq(perCase.filter(c => c.split === 'dev').map(c => c.salon_type)), allTypes = sortedUniq(perCase.map(c => c.salon_type));
  const L = [];
  L.push('# Catálogo de avaliação da Secretária: cobertura', '');
  L.push('Gerado por `node packages/salon-secretary/evaluation/dataset/build-catalog.cjs` (somente leitura sobre as fontes; não editar à mão).',
    'Dados por caso em `catalog.json`; checagens cruzadas em `.demo/agenda-core/oracle-audit/catalog-crosschecks.json`.',
    'Nenhum texto de mensagem, nome de cliente ou motivo aparece aqui: só IDs, códigos, contagens e hashes.', '');
  // headline
  const t = tot.all, dev = tot.per.dev, reg = tot.per.regression;
  L.push('## Resposta curta: quantas mensagens já foram testadas', '');
  L.push(`- **${t.luna_turns} turnos reais da Luna avaliados** em ${t.runs} rodadas (cada turno = uma mensagem do dono ou uma resposta roteirizada enviada à Luna real e avaliada pelo oráculo).`);
  L.push(`  - DEV (V, N, multi-salão): ${dev.luna_turns} turnos em ${dev.graded_attempts} tentativas avaliadas;`);
  L.push(`  - regressão (A/B/C antigas + Golden 30): ${reg.luna_turns} turnos em ${reg.graded_attempts} tentativas avaliadas;`);
  L.push(`  - escolha (validação) e prova (holdouts lacrados): **0** (nunca rodados; o registro não tem nenhuma olhada).`);
  L.push(`- **${t.distinct_sent_texts} textos distintos** efetivamente enviados (depois de datas renderizadas e ruído aplicado).`);
  L.push(`- Chamadas ao modelo: ${t.model_calls_agenda_core} nas rodadas da Agenda + ${t.provider_requests_golden} requisições nas rodadas da Golden.`);
  const catalogued = SPLITS.reduce((n, s) => n + tot.per[s].cases, 0), sealedDeclared = tot.per.validation.declared_sealed_cases + tot.per.test.declared_sealed_cases;
  L.push(`- Casos catalogados com metadados: ${catalogued} (${SPLITS.map(s => `${s} ${tot.per[s].cases}`).join(', ')}); mais ${sealedDeclared} casos lacrados declarados nos docs (${tot.per.validation.registry_sets + tot.per.test.registry_sets} conjuntos, só sha256).`);
  const say = SPLITS.reduce((n, s) => n + tot.per[s].authored_messages, 0), ans = SPLITS.reduce((n, s) => n + tot.per[s].answer_variants, 0);
  L.push(`- Mensagens escritas nesses casos: ${say} falas roteirizadas + ${ans} variações de resposta a perguntas da Secretária (só enviadas quando ela pergunta). Das ${catalogued} definições, ${cases.filter(c => c.battery !== 'registry' && c.graded.attempts > 0).length} já rodaram com a Luna real; as ${cases.filter(c => c.battery === 'MD').length} do multi-salão ainda não.`, '');
  L.push('Um "turno" conta mensagens enviadas (fala roteirizada `say` ou resposta `answer:*`); cliques de Confirmar/escolher não contam. Rodadas repetidas (k) contam cada vez: é o volume testado, não o número de frases diferentes.', '');
  // per split
  L.push('## Por gaveta (split)', '');
  L.push('| split | casos | definições distintas | mensagens roteirizadas | variações de resposta | casos já avaliados | tentativas avaliadas | aprovadas | turnos Luna | textos enviados distintos | conjuntos lacrados (casos declarados) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of SPLITS) { const p = tot.per[s]; L.push(`| ${s} | ${p.cases} | ${p.distinct_definitions} | ${p.authored_messages} | ${p.answer_variants} | ${p.cases_ever_graded} | ${p.graded_attempts} | ${p.passed_attempts} (${pct(p.passed_attempts, p.graded_attempts)}) | ${p.luna_turns} | ${p.distinct_sent_texts} | ${p.registry_sets} (${p.declared_sealed_cases}) |`); }
  L.push('', 'A taxa de aprovação acima soma todas as rodadas (inclusive as antigas, antes das correções, e as com ruído): serve para volume, não como nota. A nota vale por rodada (tabela de rodadas) e só na mesma definição de caso.', '');
  // per battery
  L.push('## Por bateria', '');
  L.push('| bateria | fonte | split | status | casos | mensagens roteirizadas | casos já avaliados | tentativas | turnos Luna | proveniência do gabarito |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const b of uniq(cases.map(c => c.battery))) {
    const list = cases.filter(c => c.battery === b), f = list[0];
    if (b === 'registry') { for (const c of list) L.push(`| ${c.id} | ${c.source} | ${c.split} | ${c.status} | ${c.declared_cases ?? '?'} (declarado) | - | 0 | 0 | 0 | ${c.oracle_provenance ?? 'sem gabarito estruturado ainda'} |`); continue; }
    const prov = Object.entries(list.reduce((a, c) => (a[c.oracle_provenance] = (a[c.oracle_provenance] ?? 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join(', ');
    L.push(`| ${b} | ${f.source} | ${f.split} | ${f.status} | ${list.length} | ${list.reduce((n, c) => n + c.messages.say, 0)} | ${list.filter(c => c.graded.attempts > 0).length} | ${list.reduce((n, c) => n + c.graded.attempts, 0)} | ${list.reduce((n, c) => n + c.graded.turns, 0)} | ${prov} |`);
  }
  L.push('');
  // runs
  L.push('## Rodadas avaliadas', '');
  L.push('| rodada | evidência | estágio | k | casos | tentativas | turnos | chamadas | válida | turnos conferem com passk.json |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const a = audit.runs.find(x => x.run === r.run_dir), g = audit.golden.runs?.find(x => x.run === r.run_dir);
    const check = a ? (a.turnsMatch === null ? 'n/a (sem passk.json)' : a.turnsMatch ? 'sim' : 'NÃO') : g ? (g.turnsMatch === null ? 'n/a' : g.turnsMatch ? 'sim (summary)' : 'NÃO') : '-';
    L.push(`| ${r.run_dir} | ${r.evidence} | ${r.stage ?? '-'} | ${r.repeat} | ${r.scenarios} | ${r.graded_attempts ?? '-'} | ${r.turns} | ${r.model_calls ?? '-'} | ${r.valid === null ? '-' : r.valid ? 'sim' : 'não'} | ${check} |`);
  }
  const noRes = (audit.golden.runs ?? []).filter(x => x.status === 'NO_RESULTS').map(x => x.run);
  if (noRes.length) L.push('', `Rodadas da Golden sem results.json (preparadas ou interrompidas antes de gravar; não contadas): ${noRes.join(', ')}.`);
  if (audit.skippedRuns.length) L.push('', `Rodadas ignoradas: ${audit.skippedRuns.map(s => `${s.run} (${s.reason})`).join(', ')}.`);
  L.push('');
  // matrix
  const cell = (o, p, s, splits) => { const v = m.get(o, p, s); return splits.map(x => v[x]).join('/'); };
  const ROWS = [...PHENOMENA, '(none)'], COLS = [...OPS, '(other)', '(none)'];
  L.push('## Matriz operações × fenômenos (todos os tipos de salão)', '');
  L.push('Célula = casos `dev/regression`. Validação e prova não entram: são só sha256 no registro, sem metadado por caso (0 atribuível).', '');
  L.push(`| fenômeno | ${COLS.join(' | ')} |`, `|---|${COLS.map(() => '---').join('|')}|`);
  for (const p of ROWS) L.push(`| ${p} | ${COLS.map(o => cell(o, p, '*', ['dev', 'regression'])).join(' | ')} |`);
  L.push('');
  for (const s of allTypes) {
    L.push(`### Tipo de salão: ${s}`, '', `Célula = casos \`dev/regression\` com salon_type = ${s}.`, '');
    L.push(`| fenômeno | ${COLS.join(' | ')} |`, `|---|${COLS.map(() => '---').join('|')}|`);
    for (const p of ROWS) L.push(`| ${p} | ${COLS.map(o => cell(o, p, s, ['dev', 'regression'])).join(' | ')} |`);
    L.push('');
  }
  // gaps
  L.push('## Lacunas (GAP)', '');
  L.push('Regra: célula com **< 3 casos em dev** e **0 fora de dev** (validação/prova não são atribuíveis, então "fora de dev" = regressão catalogada).',
    'A regra é mecânica: algumas células podem não ser pedidos reais de produto (por exemplo, leitura × desistência); priorize as de escrita (create/change/cancel/block).', '');
  const gaps1 = [];
  for (const o of OPS) for (const p of PHENOMENA) { const v = m.get(o, p, '*'); if (v.dev < 3 && v.validation + v.test + v.regression === 0) gaps1.push({ o, p, dev: v.dev }); }
  L.push(`### Nível 1: operação × fenômeno (todos os tipos): ${gaps1.length} lacunas`, '');
  L.push('| operação | fenômeno | casos dev |', '|---|---|---|');
  for (const g of gaps1.sort((a, b) => a.dev - b.dev || OPS.indexOf(a.o) - OPS.indexOf(b.o) || PHENOMENA.indexOf(a.p) - PHENOMENA.indexOf(b.p))) L.push(`| ${g.o} | ${g.p} | ${g.dev} |`);
  L.push('');
  const gaps2 = [];
  for (const o of OPS) for (const p of PHENOMENA) {
    const bad = devTypes.map(s => ({ s, v: m.get(o, p, s) })).filter(x => x.v.dev < 3 && x.v.validation + x.v.test + x.v.regression === 0);
    if (bad.length) gaps2.push({ o, p, bad });
  }
  const n2 = gaps2.reduce((n, g) => n + g.bad.length, 0);
  L.push(`### Nível 2: operação × fenômeno × tipo de salão (tipos com casos dev: ${devTypes.join(', ')}): ${n2} células`, '');
  L.push('| operação | fenômeno | tipos de salão em lacuna (casos dev) |', '|---|---|---|');
  for (const g of gaps2) L.push(`| ${g.o} | ${g.p} | ${g.bad.map(x => `${x.s} (${x.v.dev})`).join(', ')} |`);
  L.push('');
  // style / source
  L.push('## Estilo, fonte e proveniência', '');
  const count = (list, f) => Object.entries(list.reduce((a, c) => { for (const k of [].concat(f(c))) a[k] = (a[k] ?? 0) + 1; return a; }, {})).sort().map(([k, v]) => `${k} ${v}`).join(', ');
  for (const s of SPLITS) { const list = perCase.filter(c => c.split === s); if (!list.length) continue;
    L.push(`- ${s}: estilo {${count(list, c => c.style)}}; fonte {${count(list, c => c.source)}}; gabarito {${count(list, c => c.oracle_provenance)}}; tipo de salão {${count(list, c => c.salon_type)}}; nº de ações {${count(list, c => String(c.action_count))}}`); }
  const sealed = cases.filter(c => c.battery === 'registry');
  L.push('', 'Conjuntos lacrados/escolha (registro `holdout-registry.json`; conteúdo nunca lido):', '');
  L.push('| id | kind | split | status | sha256 aprovado | ids registrados | olhadas | casos declarados | doc cita o sha |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of sealed) L.push(`| ${c.id} | ${c.registry.kind} | ${c.split} | ${c.status} | ${c.sha256.slice(0, 12)}… | ${c.case_ids ? c.case_ids.length : 'não (null)'} | ${c.registry.looks} | ${c.declared_cases ?? '?'} | ${c.declared_doc_mentions_sha ? 'sim' : 'NÃO'} |`);
  L.push('');
  // sources
  L.push('## Fontes lidas (sha256 no momento da geração)', '');
  L.push('| arquivo | bateria | casos | sha256 | conferência |', '|---|---|---|---|---|');
  for (const s of built.sources) {
    const chk = s.present === false ? 'ausente' : s.battery === 'MD' ? `manifesto confere: ${s.manifestSha256Matches ? 'sim' : 'NÃO'}` : s.battery === 'GF' ? `doc confere: ${s.docSha256Matches ? 'sim' : 'NÃO'}; ids = free-use-golden.ts: ${s.tsIdsMatch ? 'sim' : 'NÃO'}` : '-';
    L.push(`| \`${s.path}\` | ${s.battery ?? '-'} | ${s.cases ?? s.holdouts ?? '-'} | ${s.sha256 ? s.sha256.slice(0, 16) + '…' : '-'} | ${chk} |`);
  }
  if (built.annotations.files.length) L.push('', `Anotações de gabarito encontradas em \`.demo/agenda-core/oracle-audit/\`: ${built.annotations.files.map(f => `\`${path.basename(f.file)}\` (${f.kind}${f.cases !== undefined ? `, ${f.cases} casos` : ''}${f.status ? ', ' + f.status : ''})`).join(', ')}.`);
  L.push('');
  // drift and caveats
  L.push('## Confiabilidade: o que conferir antes de usar um número', '');
  const drift = uniq(audit.definitionDrift.map(d => d.id)).sort();
  L.push(`- **Definição mudou depois da rodada** (${audit.definitionDrift.length} pares rodada×caso, casos: ${drift.join(', ') || 'nenhum'}): no \`results_history\` esses registros têm \`definition_matches_current: false\` e não são pareáveis com rodadas novas (mesma regra do pass^k).`);
  const lr = audit.legacyRegrade;
  if (lr.length) L.push(`- **A/B/C antigas** não têm passk.json: foram reavaliadas offline com o mapa E congelado no dia de cada rodada (\`evidence: recomputed:legacy-E-map\`, mesmas regras de \`legacyScore\`). Última série: ${lr.filter(x => /final-[abc]$/.test(x.run)).map(x => `${x.run.replace(/^.*Z-/, '')} ${x.passed}/${x.graded}`).join(', ') || '-'}.`);
  L.push('- **Golden 30**: histórico vem de `results/free-use/golden-*/results.json` (fora de `results/agenda-core`), marcado `evidence: free-use results.json`; é regressão (R11), nunca nota de qualidade.');
  L.push('- **Fenômenos**: cada rótulo diz sua base em `phenomena_basis` (`tag` = etiqueta do autor; `text` = regra de texto heurística; `template` = formato de data do roteiro; `structure` = fixture/oráculo). Rótulos só `text` são indícios, não gabarito. Concordância etiqueta×detecção por fenômeno está em `catalog-crosschecks.json` (`tagAgreement`).');
  L.push('- **Operações**: `operations_net` = escritas que o oráculo espera (diferença entre o estado semeado e o `final` exato, ou o mapa E das A/B/C); `operations` = operações exercitadas (escritas do oráculo ∪ passo `READ_DONE` ∪ operações das etiquetas do autor, porque negação, desistência e conflito terminam sem escrita). `action_count` = max(escritas do oráculo + leitura, operações exercitadas); na Golden, o maior `actionCount` do contrato. Coluna `(other)` = só operações fora da Agenda (Golden: serviço, cliente, estoque, financeiro; em `other_operations`). C10 (desistência antiga, sem etiqueta de operação) fica em `(none)`.');
  const prov = count(perCase, c => c.oracle_provenance);
  L.push(`- **Gabarito**: ${prov}. Nenhum gabarito foi adjudicado. \`double-annotated\` só aparece quando existe uma segunda anotação cega em \`.demo/agenda-core/oracle-audit/\` (a concordância é tarefa da adjudicação, não deste catálogo).`);
  L.push('- **Ruído**: nas rodadas com `--noise`, cada tentativa guarda o nível (`off`/`light`/`heavy`) em `attempts[].noise`; acentos e erros de digitação introduzidos pelo ruído não viram fenômeno do caso.');
  L.push('- **Fora do escopo deste catálogo** (rodadas reais com outros formatos): hard-conversations, ultimate-10, multi-action benchmark, t21, x94, topic14, conversational-ux, replays da Golden (sem chamada real) e as pastas `results/free-use/holdout-*` (holdouts antigos, não lidos).');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- main
/** JSON with 2-space structure down to level 3; deeper values (one history row, one attempt) and flat leaves stay on one line. */
function pretty(v, level = 0) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  const flat = Array.isArray(v) ? v.every(x => x === null || typeof x !== 'object') : level >= 3 && Object.values(v).every(x => x === null || typeof x !== 'object');
  if (level >= 4 || flat) return JSON.stringify(v);
  const pad = '  '.repeat(level), inner = '  '.repeat(level + 1);
  if (Array.isArray(v)) return v.length ? `[\n${v.map(x => inner + pretty(x, level + 1)).join(',\n')}\n${pad}]` : '[]';
  const keys = Object.keys(v).filter(k => v[k] !== undefined);
  return keys.length ? `{\n${keys.map(k => `${inner}${JSON.stringify(k)}: ${pretty(v[k], level + 1)}`).join(',\n')}\n${pad}}` : '{}';
}
function main() {
  const check = process.argv.includes('--check');
  const built = build(), tot = totals(built);
  const catalog = { schema: 'secretary-eval-catalog-v1', generator: `${EVAL}/dataset/build-catalog.cjs`,
    vocabulary: { operations: OPS, phenomena: PHENOMENA, splits: SPLITS, sources: ['owner', 'assistant', 'generated', 'independent', 'legacy'], styles: ['typing', 'voice', 'formal', 'regional'],
      oracle_provenance: ['single-author', 'double-annotated', 'adjudicated'], status: ['active', 'consumed', 'regression'] },
    rules: {
      sha256: 'case: sha256 of the canonical JSON of the case definition (same as agenda-practice-lib.ts scenarioDefinitionSha256 / passk.json `definition`); file: approved file sha256 from the holdout registry',
      turns: 'messages sent to the real Luna and graded: transcript rows `say` and `answer:*` (agenda-core) or observed turns (Golden results.json)',
      results_history: 'one row per run that graded the case: agenda-core passk.json (c/n as reported), legacy flat runs regraded with the frozen E map, Golden free-use results.json; never a sealed/validation run folder',
      phenomena_basis: 'tag = author capability tag; template = {{d:..|format}} token; text = heuristic text rule; structure = fixture/oracle structure (homonym names, discard oracle, unsupported)',
    },
    sources: built.sources, totals: tot, runs: built.runs, cases: built.cases };
  const outputs = { [OUT.catalog]: pretty(catalog) + '\n', [OUT.coverage]: coverageMd(built, tot) + '\n', [OUT.audit]: pretty(built.audit) + '\n' };
  for (const text of [outputs[OUT.catalog], outputs[OUT.audit]]) JSON.parse(text); // the compact printer must stay valid JSON
  let changed = 0;
  for (const [rel, text] of Object.entries(outputs)) {
    const p = abs(rel), same = fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text;
    if (!same) { changed++; if (!check) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); } }
  }
  const a = tot.all;
  console.log(JSON.stringify({ status: check ? (changed ? 'STALE' : 'UP_TO_DATE') : 'WRITTEN', changed, cases: built.cases.length, runs: a.runs, lunaTurns: a.luna_turns,
    distinctSentTexts: a.distinct_sent_texts, bySplit: Object.fromEntries(SPLITS.map(s => [s, { cases: tot.per[s].cases, turns: tot.per[s].luna_turns, attempts: tot.per[s].graded_attempts }])),
    drift: built.audit.definitionDrift.length, skippedRuns: built.audit.skippedRuns.length }));
  if (check && changed) process.exitCode = 1;
}
main();
