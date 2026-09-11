// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import type {ChiefState} from "@/lib/hq/chief-contract";
const f=vi.hoisted(()=>({ask:vi.fn(),history:vi.fn()}));
vi.mock("@/app/hq/agents/chief-actions",()=>({askChiefAction:f.ask,chiefHistoryAction:f.history}));
import {ChiefPilot} from "./chief-pilot";
const initial:ChiefState={ready:true,reason:"",budgetMicros:5000000,committedMicros:0,runs:[],nextCursor:null};
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("desativa consumo até configurar e informa o uso dos dados",()=>{
 render(<ChiefPilot initial={{...initial,ready:false,reason:"Configure a chave."}}/>);
 expect(screen.getByRole("button",{name:"Consultar Chefe"})).toBeDisabled();
 expect(screen.getByLabelText("Sua pergunta")).toBeDisabled();
 expect(screen.getByText("Configure a chave.")).toBeVisible();
 expect(screen.getByText(/serão enviados à OpenAI/)).toBeVisible();
});
it("protege clique concorrente e mantém o UUID após falha de transporte",async()=>{
 let reject!:(value:Error)=>void;
 f.ask.mockReturnValueOnce(new Promise((_resolve,r)=>{reject=r;}));
 render(<ChiefPilot initial={initial}/>);
 fireEvent.change(screen.getByLabelText("Sua pergunta"),{target:{value:"Como está o HQ?"}});
 fireEvent.click(screen.getByRole("button",{name:"Consultar Chefe"}));
 expect(screen.getByRole("button",{name:"Consultando…"})).toBeDisabled();
 await act(async()=>reject(new Error("offline")));
 f.ask.mockResolvedValueOnce({ok:false,error:"Em andamento"});
 fireEvent.click(screen.getByRole("button",{name:"Consultar Chefe"}));
 await act(async()=>{});
 expect(f.ask).toHaveBeenCalledTimes(2);
 expect(f.ask.mock.calls[0][0]).toEqual(f.ask.mock.calls[1][0]);
 expect(screen.getByRole("alert")).toHaveTextContent("Em andamento");
});
