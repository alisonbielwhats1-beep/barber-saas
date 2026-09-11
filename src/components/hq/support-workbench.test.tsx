// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import type {SupportState} from "@/lib/hq/support-contract";
const f=vi.hoisted(()=>({ask:vi.fn(),state:vi.fn(),review:vi.fn(),items:vi.fn()}));
vi.mock("@/app/hq/agents/support/actions",()=>({askSupportAction:f.ask,supportStateAction:f.state,reviewSupportAction:f.review,supportItemsAction:f.items}));
import {SupportWorkbench} from "./support-workbench";
const customerId="aa000000-0000-4000-8000-000000000002";
const initial:SupportState={ready:true,reason:"",budgetMicros:2000000,committedMicros:0,customerId,customers:[{id:customerId,business:"Estúdio sintético"}],customersLimited:false,runs:[],nextCursor:null,context:{business:"Estúdio sintético",status:"Ativo",tickets:0,activities:0}};
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("exige cliente e ativação e informa aprovação sem envio",()=>{
 render(<SupportWorkbench initial={{...initial,customerId:null,context:null,ready:false,reason:"Aguardando ativação"}}/>);
 expect(screen.getByRole("button",{name:"Gerar rascunho de suporte"})).toBeDisabled();expect(screen.getByLabelText("Dúvida do cliente")).toBeDisabled();expect(screen.getByText(/serão enviados à OpenAI/)).toBeVisible();
});
it("preserva solicitação após falha e não duplica clique",async()=>{
 let reject!:(error:Error)=>void;f.ask.mockReturnValueOnce(new Promise((_r,j)=>{reject=j;}));render(<SupportWorkbench initial={initial}/>);
 fireEvent.change(screen.getByLabelText("Dúvida do cliente"),{target:{value:"Como ajustar a jornada?"}});fireEvent.click(screen.getByRole("button",{name:"Gerar rascunho de suporte"}));expect(screen.getByRole("button",{name:"Aguarde…"})).toBeDisabled();
 await act(async()=>reject(new Error("offline")));f.ask.mockResolvedValue({ok:false,error:"Atualize o histórico"});fireEvent.click(screen.getByRole("button",{name:"Gerar rascunho de suporte"}));await act(async()=>{});
 expect(f.ask.mock.calls[0][0]).toEqual(f.ask.mock.calls[1][0]);expect(f.ask.mock.calls[0][0].customerId).toBe(customerId);
});
it("só registra texto editado após decisão explícita",async()=>{
 const run={id:"aa000000-0000-4000-8000-000000000003",actorId:"admin",question:"Como ajustar a jornada?",answer:null,status:"completed" as const,errorCode:null,createdAt:"2026-09-11T12:00:00Z",finishedAt:"2026-09-11T12:00:01Z",model:"synthetic",promptVersion:"ci",chargeMicros:10,inputTokens:10,outputTokens:5,sources:[],review:null,draft:{reply:"Confira a jornada.",title:"Jornada",category:"Dúvida" as const,recommendation:"reply" as const,needsHuman:false,reason:"Fonte técnica",articleIds:["horarios"]}};
 render(<SupportWorkbench initial={{...initial,runs:[run]}}/>);expect(f.review).not.toHaveBeenCalled();fireEvent.click(screen.getByText("Revisar e decidir"));fireEvent.change(screen.getByLabelText("Texto revisado"),{target:{value:"Texto que revisei para o cliente."}});fireEvent.change(screen.getByLabelText("Decisão"),{target:{value:"ticket"}});
 f.review.mockResolvedValue({ok:true,review:{decision:"ticket",text:"Texto que revisei para o cliente.",targetId:"ticket",targetType:"tickets"}});f.state.mockResolvedValue(initial);
 fireEvent.click(screen.getByRole("button",{name:"Confirmar decisão revisada"}));await act(async()=>{});expect(f.review).toHaveBeenCalledWith(expect.objectContaining({customerId,runId:run.id,decision:"ticket",text:"Texto que revisei para o cliente."}));
});
