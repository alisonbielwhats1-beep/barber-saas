import {readFileSync} from 'node:fs';
import {PrismaClient, Role} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {addDays, startOfDay, setHours} from 'date-fns';
import {assertSafeDatabaseOperation} from '../src/lib/database-safety';

assertSafeDatabaseOperation(process.env,{operation:'demo:seed'});
const url = new URL(process.env.DATABASE_URL!);
if(url.hostname !== '127.0.0.1' || url.pathname !== '/everflair_demo') throw new Error('Banco de demonstração inválido.');
const db = new PrismaClient();
const credentials = JSON.parse(readFileSync('.demo/credentials.json','utf8'));
const accountKeys = ['owner','reception','professional','client'] as const;

async function main() {
  const passwords = Object.fromEntries(await Promise.all(accountKeys.map(async key=>[key,await bcrypt.hash(credentials[key].password,12)])));
  const identity = await db.$queryRaw<Array<{name:string}>>`SELECT name FROM demo_meta.identity WHERE id=1`;
  if(identity[0]?.name !== 'everflair-synthetic-only') throw new Error('Identidade da demo não confirmada.');
  if(await db.salon.count() > 0 || await db.user.count() > 0) {
    console.log('Banco já contém dados. Seed não apaga nem sobrescreve registros.');
    return;
  }
  await db.$transaction(async tx=>{
    const owner = await tx.user.create({data:{name:'Alex Costa · Demonstração',email:credentials.owner.email,passwordHash:passwords.owner}});
    const receptionist = await tx.user.create({data:{name:'Dani Lima · Recepção Demo',email:credentials.reception.email,passwordHash:passwords.reception}});
    const labels = ['Ana Ribeiro','Bruno Martins','Camila Rocha','Diego Almeida','Elisa Santos','Felipe Souza','Gabriela Nunes','Henrique Lima','Isabela Costa','João Ferreira','Larissa Prado','Marcos Oliveira'];
    for(const [index,segment] of ['espaco-misto','barbearia'].entries()) {
      const mixed = index === 0;
      const salon = await tx.salon.create({data:{
        name:mixed?'Everflair Studio · Demonstração':'Everflair Barber · Demonstração',
        slug:mixed?'everflair-demo':'everflair-barber-demo',segment,
        description:'Ambiente de demonstração. Pessoas, valores e atendimentos são fictícios. Nenhuma reserva representa um atendimento real.',
        importantInfo:'DEMONSTRAÇÃO: não informe dados pessoais reais. Pagamento presencial é apenas simulado.',
        address:'Endereço fictício · Espaço de demonstração',plan:'PRO',accessStatus:'APPROVED',accessReviewedAt:new Date(),
        themeColorHex:mixed?'#8A4E2D':'#303438',coverUrl:mixed?'/images/brand-salon.webp':'/images/brand-barber.webp',
        paymentMethods:'PIX,CASH,CREDIT_CARD',timezone:'America/Sao_Paulo',openMinutes:540,closeMinutes:1140
      }});
      await tx.membership.createMany({data:[{salonId:salon.id,userId:owner.id,role:Role.OWNER},{salonId:salon.id,userId:receptionist.id,role:Role.RECEPTIONIST}]});
      const catalog = mixed ? [
        ['Corte e finalização',60,11000,'Cabelo'],['Barba e acabamento',30,6500,'Barbearia'],['Manicure',45,5000,'Unhas'],
        ['Cuidado facial',60,15000,'Estética'],['Massagem relaxante',60,16000,'Bem-estar'],['Hidratação',45,9000,'Cabelo']
      ] as const : [
        ['Corte clássico',45,7000,'Cabelo'],['Barba e acabamento',30,5000,'Barba'],['Corte e barba',75,11000,'Combos']
      ] as const;
      const services = [];
      for(const [name,durationMin,priceCents,category] of catalog) services.push(await tx.service.create({data:{salonId:salon.id,name,durationMin,priceCents,category,costCents:1500,colorHex:['#7B8799','#A87964','#7A9488'][services.length%3],imageUrl:mixed?'/images/brand-salon.webp':'/images/brand-barber.webp'}}));
      const pros = [];
      for(let p=0;p<3;p++) {
        const user=await tx.user.create({data:{name:['Renata Mendes','Caio Ferreira','André Santos'][p],
          email:index===0&&p===0?credentials.professional.email:'profissional'+index+p+'@everflair.example',passwordHash:passwords.professional}});
        await tx.membership.create({data:{userId:user.id,salonId:salon.id,role:Role.PROFESSIONAL}});
        const pro=await tx.professional.create({data:{salonId:salon.id,userId:user.id,commissionPct:40+p*5,colorHex:['#7B8799','#A87964','#7A9488'][p]}});
        pros.push(pro);
        await tx.professionalService.createMany({data:services.map(s=>({professionalId:pro.id,serviceId:s.id}))});
        await tx.workingHours.createMany({data:[0,1,2,3,4,5,6].map(weekday=>({salonId:salon.id,professionalId:pro.id,weekday,startMinutes:540,endMinutes:1140}))});
      }
      const clients=[];
      for(const [i,name] of labels.entries()) clients.push(await tx.clientProfile.create({data:{salonId:salon.id,name,
        email:i===0?credentials.client.email:'cliente'+index+i+'@everflair.example',passwordHash:i===0?passwords.client:null,
        notes:'Cadastro fictício de demonstração. Sem telefone real.'}}));
      const today=startOfDay(new Date());
      for(let d=-14;d<=7;d++) for(let p=0;p<pros.length;p++) for(let slot=0;slot<2;slot++) {
        const service=services[(d+14+p+slot)%services.length];
        const client=clients[(d+14+p+slot)%clients.length];
        const startAt=setHours(addDays(today,d),slot===0?9+p:14+p);
        const endAt=new Date(startAt.getTime()+service.durationMin*60000);
        const completed=endAt<new Date();
        const appointment=await tx.appointment.create({data:{salonId:salon.id,clientId:client.id,professionalId:pros[p].id,serviceId:service.id,
          startAt,endAt,priceCents:service.priceCents,status:completed?'COMPLETED':'CONFIRMED',timezone:salon.timezone,notes:'Atendimento fictício para demonstração.',
          serviceItems:{create:{serviceId:service.id,position:0,serviceName:service.name,durationMin:service.durationMin,priceCents:service.priceCents}}}});
        if(completed) await tx.payment.create({data:{appointmentId:appointment.id,amountCents:service.priceCents,currency:'BRL',method:slot===0?'PIX':'CASH',paidAt:endAt,notes:'Recebimento fictício.'}});
        if(d===-1 && slot===0) await tx.clientReview.create({data:{salonId:salon.id,appointmentId:appointment.id,clientId:client.id,rating:4+p%2,comment:'Avaliação fictícia: exemplo para conhecer esta tela.'}});
      }
      await tx.product.createMany({data:[
        {salonId:salon.id,name:'Shampoo de demonstração',priceCents:6500,stock:12,category:'Cuidados'},
        {salonId:salon.id,name:'Óleo de demonstração',priceCents:8900,stock:3,category:'Cuidados'},
        {salonId:salon.id,name:'Máscara de demonstração',priceCents:11000,stock:0,category:'Tratamento'}
      ]});
      await tx.expense.createMany({data:[
        {salonId:salon.id,description:'Aluguel · exemplo fictício',amountCents:250000,category:'Aluguel',kind:'FIXED',dueDate:addDays(today,-3),paidAt:addDays(today,-3),method:'PIX'},
        {salonId:salon.id,description:'Reposição · exemplo fictício',amountCents:45000,category:'Produtos',kind:'VARIABLE',dueDate:addDays(today,3)}
      ]});
      const pkg=await tx.package.create({data:{salonId:salon.id,name:'Pacote de demonstração',serviceId:services[0].id,sessions:5,priceCents:45000,validityDays:90}});
      await tx.packagePurchase.create({data:{salonId:salon.id,packageId:pkg.id,clientId:clients[0].id,sessionsTotal:5,sessionsUsed:1,priceCents:45000,expiresAt:addDays(today,80)}});
      await tx.portfolioItem.create({data:{salonId:salon.id,professionalId:pros[0].id,imageUrl:mixed?'/images/brand-salon.webp':'/images/brand-barber.webp',caption:'Imagem ilustrativa do ambiente de demonstração.'}});
    }
  },{timeout:120000,maxWait:10000});
  console.log('Dados fictícios criados em dois estabelecimentos. Nenhuma conta tem acesso global à plataforma.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
