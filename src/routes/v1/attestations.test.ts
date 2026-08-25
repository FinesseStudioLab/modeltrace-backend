import test from "node:test";
import assert from "node:assert";
import Fastify from "fastify";
import { v1Routes } from "./index.js";
import { prisma } from "../../core/db.js";

async function buildTestServer() {
  const app = Fastify();
  await app.register(v1Routes, { prefix: "/api/v1" });
  return app;
}

test("Row-Level Authorization", async (t) => {
  const app = await buildTestServer();

  // Seed db with test data
  const recordA = await prisma.attestation.create({
    data: {
      payer: "tenant-a",
      model: "gpt-4",
      policy: "default",
      status: "verified",
    },
  });

  const recordB = await prisma.attestation.create({
    data: {
      payer: "tenant-b",
      model: "gpt-4",
      policy: "default",
      status: "verified",
    },
  });

  await t.test("Tenant A cannot see Tenant B's data", async () => {
    // 1. Trying to list without filter
    let res = await app.inject({
      method: "GET",
      url: "/api/v1/attestations",
      headers: { "x-payer-id": "tenant-a" },
    });
    
    let json = res.json();
    assert.strictEqual(res.statusCode, 200);
    // Should only see tenant-a records
    assert.ok(json.data.every((r: any) => r.payer === "tenant-a"));
    assert.ok(!json.data.some((r: any) => r.id === recordB.id));

    // 2. Trying to filter specifically for Tenant B's payer ID (Leak attempt)
    res = await app.inject({
      method: "GET",
      url: "/api/v1/attestations?payer=tenant-b",
      headers: { "x-payer-id": "tenant-a" },
    });
    json = res.json();
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(json.data.length, 0, "Should return empty array when attempting leak");

    // 3. Trying to get Tenant B's record by ID
    res = await app.inject({
      method: "GET",
      url: `/api/v1/attestations/${recordB.id}`,
      headers: { "x-payer-id": "tenant-a" },
    });
    assert.strictEqual(res.statusCode, 404, "Should return 404 to prevent existence leak");
  });

  await t.test("Admin can see all data", async () => {
    let res = await app.inject({
      method: "GET",
      url: "/api/v1/attestations",
      headers: { "x-payer-id": "admin" },
    });
    
    let json = res.json();
    assert.strictEqual(res.statusCode, 200);
    assert.ok(json.data.some((r: any) => r.id === recordA.id));
    assert.ok(json.data.some((r: any) => r.id === recordB.id));
  });

  // Cleanup
  await prisma.attestation.delete({ where: { id: recordA.id } });
  await prisma.attestation.delete({ where: { id: recordB.id } });
  await app.close();
});
