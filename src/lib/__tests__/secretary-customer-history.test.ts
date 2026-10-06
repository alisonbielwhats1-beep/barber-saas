import {createHash} from "node:crypto";
import * as actual from "node:fs";
import {describe,expect,it} from "vitest";
import {legacyEvidenceFs} from "../../test/secretary-legacy-evidence";
import {frontHistoricalFs} from "../../test/secretary-front-history";
const sources=["src/lib/customer-contract.ts","packages/salon-secretary/src/customers-skill.ts"];
const archives=[{file:"src/test/fixtures/secretary-front-predecessor.json",manifest:"packages/salon-secretary/evaluation/results/topic14-final/real-manifest.json",key:"source_hashes",reader:frontHistoricalFs,error:"INVALID_PRE_FRONT_ARCHIVE"},{file:"src/test/fixtures/secretary-v1-frozen-sources.json",manifest:"packages/salon-secretary/evaluation/hard-conversations-plan.json",key:"predecessors",reader:legacyEvidenceFs,error:"INVALID_LEGACY_SOURCE_ARCHIVE"}];
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
describe("customer historical source-byte preservation does not authorize current runtime",()=>{
 for(const archive of archives)for(const source of sources){
  it(archive.file+" replays the immutable original "+source,()=>{
   const expected=JSON.parse(actual.readFileSync(archive.manifest,"utf8"))[archive.key][source],read=archive.reader(actual);
   expect(sha(read(source))).toBe(expected);expect(sha(actual.readFileSync(source))).not.toBe(expected);
  });
  it(archive.file+" rejects even one changed byte of "+source,()=>{
   const changed=JSON.parse(actual.readFileSync(archive.file,"utf8"));changed[source]+=" ";
   const alteredRead=((file:Parameters<typeof actual.readFileSync>[0],options?:Parameters<typeof actual.readFileSync>[1])=>String(file).replaceAll("\\","/").endsWith(archive.file)?JSON.stringify(changed):actual.readFileSync(file,options)) as typeof actual.readFileSync;
   expect(()=>archive.reader({...actual,readFileSync:alteredRead})).toThrow(archive.error);
  });
 }
});
