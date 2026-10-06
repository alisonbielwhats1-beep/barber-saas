import { expandedWire, operationWire } from '../../test/secretary-wire-schema';
import { describe, expect, it, vi } from "vitest";
import { createServicesAgent, schedulingFields } from "@everflair/salon-secretary";
import { serviceScript } from "../../test/scripted-services-model";

describe("weekday constraints survive the SDK transport conversion", () => {
  it.each([false, true])("publishes the backend's 0–6 integer bounds (V2=%s)", v2 => {
    const agent = createServicesAgent(serviceScript(), vi.fn(), "discovery", v2);
    const tool = agent.tools[0];
    if (tool.type !== "function") throw Error("DISCOVERY_TOOL_SHAPE");
    const properties = operationWire(expandedWire(tool.parameters), "appointment.create");
    for (const key of ["weekday", "source_weekday"] as const) {
      expect(properties[key].anyOf!.find(branch=>branch.type==='object')!.properties!.value).toMatchObject({ type: "integer", minimum: 0, maximum: 6 });
      expect(JSON.stringify(properties[key])).toContain("0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado");
      expect(schedulingFields[key].safeParse(7).success).toBe(false);
      expect(schedulingFields[key].safeParse(0).success).toBe(true);
      expect(schedulingFields[key].safeParse(6).success).toBe(true);
    }
  });
});
