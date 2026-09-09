import { describe, expect, it } from "vitest";
import { replaceDailyShifts, teamScheduleInput } from "../team-schedule";

const input = { professionalIds: ["professional-a"], openMinutes: 360, closeMinutes: 1260, pause: { startMinutes: 750, endMinutes: 900 }, confirmed: true as const };
describe("expediente compartilhado", () => {
  it("aplica 06h–21h com pausa 12h30–15h preservando folgas e sem duplicar dias", () => {
    const result = replaceDailyShifts([{ weekday: 2, startMinutes: 540, endMinutes: 720 }, { weekday: 2, startMinutes: 780, endMinutes: 1080 }, { weekday: 4, startMinutes: 540, endMinutes: 1080 }], teamScheduleInput.parse(input));
    expect(result).toEqual([2, 4].flatMap(weekday => [{ weekday, startMinutes: 360, endMinutes: 750 }, { weekday, startMinutes: 900, endMinutes: 1260 }]));
  });
  it.each([
    { closeMinutes: 360 }, { pause: { startMinutes: 350, endMinutes: 900 } }, { pause: { startMinutes: 900, endMinutes: 750 } }, { pause: { startMinutes: 750, endMinutes: 1260 } }, { confirmed: false }, { professionalIds: [] },
  ])("recusa configuração inválida ou sem confirmação: %j", patch => {
    expect(teamScheduleInput.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it("permite terminar à meia-noite sem criar jornada no dia seguinte", () => {
    expect(replaceDailyShifts([{ weekday: 6, startMinutes: 540, endMinutes: 1080 }], teamScheduleInput.parse({ ...input, closeMinutes: 1440, pause: null }))).toEqual([{ weekday: 6, startMinutes: 360, endMinutes: 1440 }]);
  });
});
