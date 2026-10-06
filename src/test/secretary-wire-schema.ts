import type { SecretaryWireSchema } from '@everflair/salon-secretary';
/** Resolve local JSON Schema references for assertions, retaining all constraints. */
export function expandedWire(input:unknown):SecretaryWireSchema {
  const root=JSON.parse(JSON.stringify(input)) as SecretaryWireSchema;
  const visit=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.map(visit);
    if(value && typeof value==='object') {
      const object=value as Record<string,unknown>;
      if(typeof object.$ref==='string') {
        if(!object.$ref.startsWith('#/$defs/')) throw Error('NONLOCAL_SCHEMA_REF');
        const target=root.$defs?.[object.$ref.slice('#/$defs/'.length)];
        if(!target)throw Error('UNRESOLVED_SCHEMA_REF');
        return visit(target);
      }
      return Object.fromEntries(Object.entries(object).filter(([key])=>key!=='$defs').map(([key,value])=>[key,visit(value)]));
    }
    return value;
  };
  return visit(root) as SecretaryWireSchema;
}
export function operationWire(selection:SecretaryWireSchema,operation:string):Record<string,SecretaryWireSchema> {
  if(selection.properties?.turn)selection=turnWire(selection,'NEW');
  const item=selection.properties!.operations.items!;
  const branch=(item.anyOf ?? item.properties!.fields.anyOf)!.find(schema=>schema.properties!.operation.enum?.includes(operation) || schema.properties!.operation.anyOf?.some(value=>value.enum?.includes(operation)));
  if(!branch)throw Error('MISSING_OPERATION_SCHEMA:'+operation);
  return {...branch.properties!,...(item.properties?.item_key?{item_key:item.properties.item_key}:{})};
}
export const suspendedWirePlan={plan_ref:'10000000-0000-4000-8000-000000000001',actions:[{item_key:'a',operation:'appointment.change',status:'NEEDS_INPUT',depends_on:[]}]};

export function turnWire(wire:SecretaryWireSchema,mode:string):SecretaryWireSchema {
  const branch=wire.properties?.turn?.anyOf?.find(branch=>branch.properties?.mode?.enum?.includes(mode));
  if(!branch)throw Error('MISSING_TURN_MODE:'+mode);return branch;
}
