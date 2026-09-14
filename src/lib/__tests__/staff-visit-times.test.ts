import { expect, it } from "vitest";
import {
  staffVisitTimes,
  displayMinutes,
  timeMinutes,
} from "../staff-visit-times";
const services = [
  { id: "a", durationMin: 45 },
  { id: "b", durationMin: 150 },
];
const rows = [
  { serviceId: "a", professionalId: "p", time: "" },
  { serviceId: "b", professionalId: "q", time: "" },
];
it("calcula início e término visíveis e recalcula quando muda a visita ou a duração", () => {
  expect(staffVisitTimes(rows, "09:00", services)).toEqual([
    { start: 540, end: 585, valid: true },
    { start: 585, end: 735, valid: true },
  ]);
  expect(
    staffVisitTimes(rows, "10:00", [
      { id: "a", durationMin: 60 },
      services[1]!,
    ])[1]!.start,
  ).toBe(660);
});
it("mantém o horário explícito e segue a sequência a partir dele", () => {
  const times = staffVisitTimes(
    [rows[0]!, { ...rows[1]!, customTime: true, time: "09:00" }, rows[0]!],
    "09:00",
    services,
  );
  expect(times.map((t) => t.start)).toEqual([540, 540, 690]);
});
it("não transforma vazio em meia-noite nem esconde passagem para outro dia", () => {
  expect(timeMinutes("")).toBeNull();
  expect(timeMinutes("24:00")).toBeNull();
  expect(staffVisitTimes(rows, "23:00", services)[1]!.valid).toBe(false);
  expect(
    staffVisitTimes([{ ...rows[0]!, customTime: true }], "09:00", services)[0]!
      .valid,
  ).toBe(false);
  expect(staffVisitTimes([rows[0]!], "23:15", services)[0]!.valid).toBe(true);
  expect(displayMinutes(1440)).toBe("24:00");
  expect(displayMinutes(1500)).toBe("—");
});
