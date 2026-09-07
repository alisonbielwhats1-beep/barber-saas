import test from "node:test";
import assert from "node:assert/strict";
import { probeHealth, reconcileIncident, HEALTH_URL } from "./health-monitor.mjs";

const ok = () => new Response(JSON.stringify({ status: "ok", service: "salon-saas", checks: { database: "ok" } }));

test("confirms application and database, without following redirects", async () => {
  const result = await probeHealth({ fetcher: async (url, options) => {
    assert.equal(url, HEALTH_URL);
    assert.equal(options.redirect, "error");
    return ok();
  } });
  assert.deepEqual(result, { healthy: true, reason: "OK", attempts: 1 });
});

test("retries transient failures before opening an incident", async () => {
  let calls = 0;
  const result = await probeHealth({ fetcher: async () => ++calls === 1 ? new Response("", { status: 503 }) : ok(), wait: async () => {} });
  assert.equal(result.healthy, true);
  assert.equal(result.attempts, 2);
});

test("rejects HTML, incomplete health responses and unavailable databases", async () => {
  for (const body of ["<html>login</html>", JSON.stringify({ status: "ok" }), JSON.stringify({ status: "ok", service: "salon-saas", checks: { database: "error" } })]) {
    const result = await probeHealth({ fetcher: async () => new Response(body), wait: async () => {} });
    assert.deepEqual(result, { healthy: false, reason: "INVALID_HEALTH_RESPONSE", attempts: 3 });
  }
});

test("does not leak network errors or HTTP response contents", async () => {
  for (const fetcher of [async () => { throw new Error("secret credential"); }, async () => new Response("private data", { status: 500 })]) {
    const result = await probeHealth({ fetcher, wait: async () => {} });
    assert.equal(result.healthy, false);
    assert.equal(result.attempts, 3);
    assert.doesNotMatch(JSON.stringify(result), /secret|private/);
  }
});

test("opens one incident, stays quiet, then closes it on recovery", async () => {
  const rows = [];
  let mutations = 0;
  const github = {
    paginate: async () => rows.filter(row => row.state !== "closed"),
    rest: { issues: {
      listForRepo: () => {},
      create: async (input) => { mutations++; rows.push({ ...input, number: 1, user: { login: "github-actions[bot]" } }); return { data: { number: 1 } }; },
      update: async (input) => { mutations++; Object.assign(rows[0], input); },
    } },
  };
  const context = { repo: { owner: "owner", repo: "repo" }, serverUrl: "https://github.com", runId: 1 };
  const down = { healthy: false, reason: "HTTP_503", attempts: 3 };
  assert.equal((await reconcileIncident({ github, context, result: down })).action, "opened");
  assert.equal((await reconcileIncident({ github, context, result: down })).action, "unchanged");
  assert.equal((await reconcileIncident({ github, context, result: { healthy: true } })).action, "closed");
  assert.equal((await reconcileIncident({ github, context, result: { healthy: true } })).action, "unchanged");
  assert.equal(mutations, 2);
});

test("does not alter user-created issues with a copied monitor marker", async () => {
  let created = false;
  const github = { paginate: async () => [{ number: 42, user: { login: "someone" }, body: "<!-- everflair-availability-monitor-v1 -->" }], rest: { issues: {
    listForRepo() {}, create: async () => { created = true; return { data: { number: 43 } }; }, update() { assert.fail("must not close another user's issue"); },
  } } };
  const context = { repo: { owner: "owner", repo: "repo" }, serverUrl: "https://github.com", runId: 2 };
  await reconcileIncident({ github, context, result: { healthy: true } });
  await reconcileIncident({ github, context, result: { healthy: false, reason: "HTTP_503" } });
  assert.equal(created, true);
});
