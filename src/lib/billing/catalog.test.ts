import { describe, it, expect } from "vitest";
import { accessState, periodEnd, quoteContract } from "./catalog";
describe("billing contract and access", () => {
  it.each([
    ["INDIVIDUAL",5990,59880,1], ["TEAM",7990,77880,3], ["TEAM_PLUS",9990,95880,5], ["TEAM_MAX",14990,143880,10],
  ])("snapshots %s monthly and annual", (plan, monthly, annual, agendas) => {
    expect(quoteContract({plan,cycle:"MONTHLY"})).toMatchObject({amountCents:monthly,agendaLimit:agendas,intervalMonths:1});
    expect(quoteContract({plan,cycle:"ANNUAL"})).toMatchObject({amountCents:annual,agendaLimit:agendas,intervalMonths:12});
  });
  it("prices extras on the server and rejects supplied prices", () => {
    expect(quoteContract({plan:"TEAM_MAX",cycle:"ANNUAL",extraAgendas:2})).toMatchObject({amountCents:172680,agendaLimit:12});
    expect(()=>quoteContract({plan:"TEAM",cycle:"MONTHLY",extraAgendas:1})).toThrow();
    expect(()=>quoteContract({plan:"TEAM",cycle:"MONTHLY",amountCents:1})).toThrow();
    expect(()=>quoteContract({plan:"TEAM_MAX",cycle:"MONTHLY",extraAgendas:0.5})).toThrow();
  });
  it("uses calendar months, handles leap years and does not add access on retries", () => {
    expect(periodEnd(new Date("2028-01-31T13:00:00Z"),1).toISOString()).toBe("2028-02-29T13:00:00.000Z");
    expect(periodEnd(new Date("2028-02-29T13:00:00Z"),12).toISOString()).toBe("2029-02-28T13:00:00.000Z");
  });
  it("allows five days only after verified renewal failure and preserves paid cancellation", () => {
    const paidThrough=new Date("2026-10-01T12:00:00Z");
    const sub={paidThrough,delinquentSince:paidThrough,cancelledAt:null};
    expect(accessState(sub,new Date("2026-10-06T11:59:59Z"))).toBe("GRACE");
    expect(accessState(sub,new Date("2026-10-06T12:00:00Z"))).toBe("RESTRICTED");
    expect(accessState({...sub,delinquentSince:null},new Date("2026-10-09T12:00:00Z"))).toBe("VERIFYING");
    expect(accessState({...sub,cancelledAt:new Date()},new Date("2026-09-30T12:00:00Z"))).toBe("ACTIVE");
    expect(accessState({...sub,cancelledAt:new Date()},paidThrough)).toBe("EXPIRED");
    expect(accessState({...sub,paidThrough:null})).toBe("UNPAID");
  });
});
