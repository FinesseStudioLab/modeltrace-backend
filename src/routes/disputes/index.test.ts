import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { registerAuthHooks } from "../../auth/plugin.js";
import { createTestAuthProvider } from "../../auth/testing.js";
import { disputeRoutes } from "./index.js";
import { DisputeStore } from "./store.js";

async function buildApp(opts: { windowMs?: number; store?: DisputeStore } = {}) {
  const app = Fastify();
  const auth = createTestAuthProvider();
  app.decorate("auth", auth);
  registerAuthHooks(app, auth);
  await app.register(disputeRoutes, opts);
  await app.ready();
  return app;
}

function headers(role: string, userId: string, scopes: string[] = ["dispute:read", "dispute:write", "admin"]) {
  return {
    "x-role": role,
    "x-test-auth": `${userId},${scopes.join(",")}`,
    "content-type": "application/json",
  };
}

test("a buyer can raise a dispute with evidence, hash-committed", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/disputes",
    headers: headers("buyer", "buyer-1"),
    payload: {
      settlementId: "s1",
      reason: "item not delivered",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      evidence: "tracking shows no delivery",
    },
  });

  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.status, "open");
  assert.equal(body.evidence.length, 1);
  assert.equal(body.evidence[0].contentHash.length, 64); // sha256 hex
  assert.equal(body.evidence[0].content, "tracking shows no delivery");
});

test("listing is role-scoped: a seller cannot see another party's dispute", async () => {
  const app = await buildApp();
  await app.inject({
    method: "POST",
    url: "/disputes",
    headers: headers("buyer", "buyer-1"),
    payload: {
      settlementId: "s1",
      reason: "x",
      buyerId: "buyer-1",
      sellerId: "seller-1",
    },
  });

  const asOutsider = await app.inject({
    method: "GET",
    url: "/disputes",
    headers: headers("seller", "seller-unrelated"),
  });
  assert.deepEqual(asOutsider.json(), []);

  const asAdjudicator = await app.inject({
    method: "GET",
    url: "/disputes",
    headers: headers("adjudicator", "adj-1"),
  });
  assert.equal(asAdjudicator.json().length, 1);
});

test("only a party to the dispute may add evidence", async () => {
  const app = await buildApp();
  const raise = await app.inject({
    method: "POST",
    url: "/disputes",
    headers: headers("buyer", "buyer-1"),
    payload: { settlementId: "s1", reason: "x", buyerId: "buyer-1", sellerId: "seller-1" },
  });
  const id = raise.json().id;

  const outsider = await app.inject({
    method: "POST",
    url: `/disputes/${id}/evidence`,
    headers: headers("buyer", "someone-else"),
    payload: { content: "not my dispute" },
  });
  assert.equal(outsider.statusCode, 403);

  const seller = await app.inject({
    method: "POST",
    url: `/disputes/${id}/evidence`,
    headers: headers("seller", "seller-1"),
    payload: { content: "here's my side" },
  });
  assert.equal(seller.statusCode, 200);
  assert.equal(seller.json().evidence.length, 1);
});

test("only an adjudicator may resolve, and resolving fires a notification", async () => {
  const store = new DisputeStore();
  const app = await buildApp({ store });
  const raise = await app.inject({
    method: "POST",
    url: "/disputes",
    headers: headers("buyer", "buyer-1"),
    payload: { settlementId: "s1", reason: "x", buyerId: "buyer-1", sellerId: "seller-1" },
  });
  const id = raise.json().id;

  const asBuyer = await app.inject({
    method: "POST",
    url: `/disputes/${id}/resolve`,
    headers: headers("buyer", "buyer-1"),
    payload: { outcome: "buyer", notes: "resolved" },
  });
  assert.equal(asBuyer.statusCode, 403);

  const asAdjudicator = await app.inject({
    method: "POST",
    url: `/disputes/${id}/resolve`,
    headers: headers("adjudicator", "adj-1"),
    payload: { outcome: "buyer", notes: "evidence supports buyer" },
  });
  assert.equal(asAdjudicator.statusCode, 200);
  assert.equal(asAdjudicator.json().status, "resolved");

  const events = store.notifications.map((n) => n.event);
  assert.deepEqual(events, ["raised", "resolved"]);
});

test("evidence is rejected once the window has closed", async () => {
  const app = await buildApp({ windowMs: -1 }); // already closed
  const raise = await app.inject({
    method: "POST",
    url: "/disputes",
    headers: headers("buyer", "buyer-1"),
    payload: { settlementId: "s1", reason: "x", buyerId: "buyer-1", sellerId: "seller-1" },
  });
  const id = raise.json().id;

  const res = await app.inject({
    method: "POST",
    url: `/disputes/${id}/evidence`,
    headers: headers("buyer", "buyer-1"),
    payload: { content: "too late" },
  });
  assert.equal(res.statusCode, 409);
});

test("requests without credentials are rejected", async () => {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: "/disputes" });
  assert.equal(res.statusCode, 401);
});

test("requests with the wrong scope are rejected", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/disputes",
    headers: headers("buyer", "buyer-1", ["meta:read"]),
  });
  assert.equal(res.statusCode, 403);
});
