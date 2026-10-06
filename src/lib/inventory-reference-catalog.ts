import type { Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { assertInventoryAccess } from "./inventory-catalog";

/** Minimal tenant-owned vocabulary for proving reference conflicts, never sent to the model. */
export async function inventoryReferenceCatalog(tx:Tx,actor:ServiceActor){
  await assertInventoryAccess(tx,actor);
  const rows:{id:string;name:string}[]=[];let cursor:string|undefined;
  // Bounded pages, not a business cap on catalog size. The enclosing tenant
  // transaction retains its timeout; any read failure aborts preparation.
  for(;;){
    const page=await tx.product.findMany({where:{salonId:actor.salonId},select:{id:true,name:true},orderBy:{id:"asc"},take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    rows.push(...page);if(page.length<200)break;cursor=page[page.length-1].id;
  }
  return rows;
}
