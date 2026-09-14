export type StaffVisitRow = {
  serviceId: string;
  professionalId: string;
  time: string;
  customTime?: boolean;
};
export function timeMinutes(value: string): number | null {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    : null;
}
export function displayMinutes(minutes: number | null): string {
  if (minutes === null || minutes < 0 || minutes > 1440) return "—";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function staffVisitTimes(
  rows: StaffVisitRow[],
  startTime: string,
  services: { id: string; durationMin: number }[],
) {
  let previousEnd = timeMinutes(startTime);
  return rows.map((row) => {
    const duration = services.find(
      (service) => service.id === row.serviceId,
    )?.durationMin;
    const start = row.customTime ? timeMinutes(row.time) : previousEnd;
    const end =
      start !== null && duration !== undefined ? start + duration : null;
    previousEnd = end;
    return {
      start,
      end,
      valid: start !== null && start < 1440 && end !== null && end <= 1440,
    };
  });
}
