// Final-state oracle for the Agenda practice scenarios. Day offsets are relative to the run day.
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const day = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fri = (() => { for (let n = 1; n < 8; n++) { const d = new Date(today); d.setDate(d.getDate() + n); if (d.getDay() === 5) return n; } })();
const thu = fri - 1;
// Each expectation: appointments that must exist (substring checks) and blocks; `none` = no DB change expected.
const A = (who, svc, d, time, pro, status = 'CONFIRMED') => `${who} | ${svc} | ${day(d)} ${time}→`;
const E = {
  A01: { has: [[A('Amanda Souza', 'Corte Completo', 1, '11:00'), 'Tatiana Rocha | CONFIRMED']] },
  A02: { has: [[A('Amanda Souza', 'Escova', 1, '11:00'), 'CONFIRMED']] },
  A03: { has: [['João Pereira', 'CANCELLED']] },
  A04: { has: [['João Pereira', 'CANCELLED'], [A('Fábio Santos', 'Corte Completo', 1, '14:00'), 'Ricardo Alves | CONFIRMED']] },
  A05: { none: true },
  A06: { blocks: [`Tatiana Rocha | ${day(1)} 14:00→${day(1)} 18:00`] },
  A07: { has: [['Amanda Souza', 'CANCELLED'], [A('Fábio Santos', 'Corte Completo', 1, '10:00'), 'Tatiana Rocha | CONFIRMED']] },
  A08: { has: [[A('João Pereira', 'Corte Completo', fri, '15:00'), 'CONFIRMED']], blocks: [`Tatiana Rocha | ${day(fri)} 17:00→${day(fri)} 19:00`] },
  A09: { has: [['João Pereira', 'CANCELLED'], [A('Fábio Santos', 'Corte Completo', 1, '14:00'), 'Ricardo Alves | CONFIRMED']] },
  A10: { none: true },
  A11: { has: [[A('Carla Mendes', 'Escova', 1, '14:00'), 'CONFIRMED']] },
  A12: { has: [[A('Amanda Souza', 'Corte Completo', 1, '16:00'), 'Tatiana Rocha | CONFIRMED']] },
  A13: { has: [[A('Fábio Santos', 'Corte Completo', 1, '09:00'), 'Ricardo Alves | CONFIRMED']] },
  A14: { has: [[A('Carla Mendes', 'Escova', 1, '16:00'), 'CONFIRMED']] },
  A15: { has: [['João Pereira', 'CANCELLED'], [A('Fábio Santos', 'Corte Completo', 1, '14:00'), 'Ricardo Alves | CONFIRMED']] },
  B01: { none: true }, B02: { none: true },
  B03: { has: [[A('Rosa Viana', 'Escova', fri, '09:30'), 'CONFIRMED']] },
  B04: { has: [[A('Amanda Souza', 'Escova', 1, '15:00'), 'CONFIRMED']] },
  B05: { has: [[A('Carla Mendes', 'Escova', 1, '11:00'), 'CONFIRMED']] },
  B06: { has: [[A('João Pereira', 'Corte Completo', fri, '10:00'), 'CONFIRMED']] },
  B07: { has: [['Amanda Souza', 'CANCELLED']] },
  B08: { has: [[A('Amanda Souza', 'Corte Completo', 1, '10:00'), 'Tatiana Rocha | CONFIRMED'], ['João Pereira', 'CANCELLED']] },
  B09: { blocks: [`Ricardo Alves | ${day(fri)} 09:00→${day(fri)} 19:00`] },
  B10: { none: true }, B11: { none: true }, B12: { none: true },
  B13: { has: [[A('Amanda Souza', 'Escova', 1, '16:30'), 'CONFIRMED']] },
  C01: { has: [[A('Amanda Souza', 'Corte Completo', 1, '10:00'), 'Ricardo Alves | CONFIRMED']] },
  C02: { has: [[A('Amanda Souza', 'Escova', 2, '10:00'), 'CONFIRMED']] },
  C03: { has: [['João Pereira', 'CANCELLED']] },
  C04: { none: true },
  C05: { blocks: [`Tatiana Rocha | ${day(1)} 12:00→${day(1)} 13:00`] },
  C06: { has: [[A('Carla Mendes', 'Escova', thu, '14:00'), 'CONFIRMED'], [A('Rosa Viana', 'Coloração', thu, '15:00'), 'CONFIRMED']] },
  C07: { has: [[A('Rosa Viana', 'Escova', 2, '11:00'), 'CONFIRMED']] },
  C08: { none: true },
  C09: { has: [[A('Fábio Santos', 'Barba', 1, '17:00'), 'CONFIRMED'], ['Carla Mendes', 'CANCELLED']] },
  C10: { none: true },
  C11: { has: [[A('Amanda Souza', 'Escova', 1, '10:00'), 'CONFIRMED']] },
  C12: { has: [[A('Fábio Santos', 'Barba', 1, '16:00'), 'Ricardo Alves | CONFIRMED']] },
};
const rows = [];
for (const f of fs.readdirSync(dir).filter(f => /^[A-Z][0-9]+[.]json$/.test(f)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), id = r.scenario.id, e = E[id];
  const last = r.transcript.at(-1)?.db ?? { appointments: [], blocks: [] };
  const errors = r.transcript.filter(t => t.error && t.error !== 'NOTHING_TO_CONFIRM').map(t => t.error);
  const unconfirmed = r.transcript.filter(t => t.error === 'NOTHING_TO_CONFIRM').length;
  let ok = true; const why = [];
  if (!e) { ok = false; why.push('NO_ORACLE'); }
  else if (e.none) { if (JSON.stringify(last.appointments) !== JSON.stringify(r.initial.appointments) || last.blocks.length) { ok = false; why.push('UNEXPECTED_DB_CHANGE'); } }
  else {
    for (const parts of e.has ?? []) if (!last.appointments.some(a => parts.every(p => a.includes(p)))) { ok = false; why.push('MISSING ' + parts.join(' & ')); }
    for (const b of e.blocks ?? []) if (!last.blocks.some(x => x.startsWith(b))) { ok = false; why.push('MISSING_BLOCK ' + b); }
  }
  const turns = r.transcript.filter(t => t.action === 'say' || String(t.action).startsWith('answer')).length;
  const questions = r.transcript.filter(t => (t.action === 'say' || String(t.action).startsWith('answer')) && t.pending?.length).length;
  rows.push({ id, ok, turns, questions, unconfirmed, errors, why });
}
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} turns=${r.turns} asked=${r.questions}${r.unconfirmed ? ' unconfirmed=' + r.unconfirmed : ''}${r.errors.length ? ' errors=' + r.errors.join(',') : ''}${r.why.length ? ' :: ' + r.why.join(' | ') : ''}`);
console.log(`TOTAL ${rows.filter(r => r.ok).length}/${rows.length}`);
