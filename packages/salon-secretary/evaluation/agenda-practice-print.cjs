const fs=require('fs'),path=require('path');const dir=process.argv[2],only=process.argv[3]?.split(',');
for(const f of fs.readdirSync(dir).filter(f=>/^[A-Z][0-9]+[.]json$/.test(f))){
 const r=JSON.parse(fs.readFileSync(path.join(dir,f)));if(only&&!only.includes(r.scenario.id))continue;
 console.log('\n==== '+r.scenario.id+' '+r.scenario.title+' ====');console.log('INITIAL:',JSON.stringify(r.initial.appointments));
 for(const t of r.transcript){console.log(`#${t.step} ${t.action}${t.input?' "'+t.input+'"':''}${t.error?' ERROR='+t.error:''} calls=${t.calls} ${t.latencyMs}ms pending=${JSON.stringify(t.pending)}`);
  if(t.noise)console.log(`  NOISE ${t.noise.level} ${t.noise.seed}${t.noise.sent!==t.noise.original?' original="'+t.noise.original+'" rules='+t.noise.rules.join(','):' (unchanged)'}`);
  if(t.stale)console.log('  SEC(erro):',String(t.reply??'').replace(/\n/g,' | ').slice(0,400));
  const v=t.view;if(!v)continue;console.log(t.stale?'  SEC(estado anterior):':'  SEC:',v.message.replace(/\n/g,' | ').slice(0,400));
  if(v.plan)console.log('  PLAN:',v.plan.status,JSON.stringify(v.plan.actions.map(a=>[a.key,a.operation,a.status,a.missing.join('+'),a.depends_on.join('+')])),JSON.stringify(v.plan.groups.map(g=>[g.key,g.status])));
  for(const o of v.operations||[]){if(o.scheduling){const s=o.scheduling;console.log('  SCH',o.keys?.join('+'),s.operation,JSON.stringify(Object.fromEntries(Object.entries(s.fields||{}).filter(([k])=>!k.endsWith('_ref')))),'missing='+(s.missing||[]).join('+'),s.waiting_for?'wait='+s.waiting_for:'',s.review?'REVIEW='+JSON.stringify(s.review):'',s.candidates?'CAND='+s.candidates.join('/'):'',s.alternatives?'ALT='+s.alternatives.join(','):'',s.proposal?'PROPOSAL='+s.proposal.replace(/\n/g,' | '):'',s.receipt?'RECEIPT='+JSON.stringify(s.receipt):'');}
   if(o.batch){const b=o.batch;console.log('  BATCH',JSON.stringify(b.items?.map(i=>[i.key,i.operation,Object.fromEntries(Object.entries(i.fields).filter(([k])=>!k.endsWith('_ref'))),i.depends_on])),'missing='+(b.missing||[]).join('+'),b.review?'REVIEW='+JSON.stringify(b.review).slice(0,300):'',b.candidates?'CAND='+JSON.stringify(b.candidates).slice(0,200):'',b.proposal?'PROPOSAL='+b.proposal.replace(/\n/g,' | '):'',b.receipt?'RECEIPT':'');}
   if(o.other)console.log('  OTHER',JSON.stringify(o.other));}
  console.log('  DB:',JSON.stringify(t.db));}}
