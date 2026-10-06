import { createHash } from "node:crypto";
/** Future adapters implement this contract; no external adapter is instantiated in this Gate. */
export interface CommunicationProvider {
  send(input:{idempotencyKey:string;recipient:string;content:string}):Promise<{status:"SIMULATED"}|{status:"FAILED";error_code:string}>;
}
export function assertLocalCommunication(){
  const url=new URL(process.env.DATABASE_URL??"http://invalid");
  if(!["test","development"].includes(process.env.APP_ENV??"")||url.hostname!=="127.0.0.1"||url.port!=="55441"||url.pathname!=="/everflair_service_mvp"||process.env.VERCEL_ENV==="production")throw Error("COMMUNICATION_LOCAL_ONLY");
}
/** No network, timers or credentials. Never records contact or message body in telemetry. */
export class FakeCommunicationProvider implements CommunicationProvider {
  readonly calls:{idempotency_key:string;content_hash:string}[]=[];
  private results=new Map<string,Awaited<ReturnType<CommunicationProvider["send"]>>>();
  constructor(private readonly fail=false){}
  async send(input:{idempotencyKey:string;recipient:string;content:string}){
    assertLocalCommunication();
    const old=this.results.get(input.idempotencyKey);if(old)return old;
    this.calls.push({idempotency_key:input.idempotencyKey,content_hash:createHash("sha256").update(input.content).digest("hex")});
    const result=this.fail?{status:"FAILED" as const,error_code:"FAKE_FAILURE"}:{status:"SIMULATED" as const};
    this.results.set(input.idempotencyKey,result);return result;
  }
}
