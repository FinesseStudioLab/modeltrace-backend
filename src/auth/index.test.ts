import assert from "node:assert/strict";
import { test } from "node:test";
import { generateApiKey, hashApiKeySecret, parseApiKeyStore, resolveAuthProvider } from "./provider.js";
import type { ApiKeyEntry, AuthScope } from "./types.js";

const secret = "dev-secret-32-chars-long!!";

function buildProvider(store: ApiKeyEntry[] = []) {
  return resolveAuthProvider({ jwtSecret: secret, apiKeyStore: store });
}

function mockRequest(authHeader?: string) {
  return { headers: { authorization: authHeader } } as import("fastify").FastifyRequest;
}

test("generateApiKey produces a detectable prefix and storable hash", () => {
  const { key, entry } = generateApiKey("gateway-prod", ["usage:write"]);
  assert.ok(key.startsWith("mt_gateway-prod_"));
  assert.equal(entry.name, "gateway-prod");
  assert.equal(entry.prefix, "mt_gateway-prod");
  assert.ok(entry.hash.length > 0);
  assert.ok(entry.salt.length > 0);
});

test("API key authentication succeeds with a valid key", async () => {
  const { key, entry } = generateApiKey("gateway-prod", ["usage:write", "attest:write"]);
  const provider = buildProvider([entry]);

  const identity = await provider.authenticate(mockRequest(`ApiKey ${key}`));
  assert.notEqual(identity, null);
  assert.equal(identity!.type, "gateway");
  assert.equal(identity!.subject, "gateway-prod");
  assert.deepEqual(identity!.scopes, ["usage:write", "attest:write"]);
});

test("API key authentication fails for an invalid secret", async () => {
  const { entry } = generateApiKey("gateway-prod", ["usage:write"]);
  const provider = buildProvider([entry]);

  const identity = await provider.authenticate(mockRequest("ApiKey mt_gateway-prod_not-the-secret"));
  assert.equal(identity, null);
});

test("API key authentication fails for an expired key", async () => {
  const { key, entry } = generateApiKey("gateway-old", ["usage:write"]);
  entry.expiresAt = new Date(Date.now() - 86_400_000).toISOString();
  const provider = buildProvider([entry]);

  const identity = await provider.authenticate(mockRequest(`ApiKey ${key}`));
  assert.equal(identity, null);
});

test("operator JWT authentication succeeds with a valid token", async () => {
  const provider = buildProvider();
  const token = await provider.issueOperatorToken("operator-1", ["export:read"] as AuthScope[]);

  const identity = await provider.authenticate(mockRequest(`Bearer ${token}`));
  assert.notEqual(identity, null);
  assert.equal(identity!.type, "operator");
  assert.equal(identity!.subject, "operator-1");
  assert.deepEqual(identity!.scopes, ["export:read"]);
});

test("operator JWT authentication fails for a tampered token", async () => {
  const provider = buildProvider();
  const token = await provider.issueOperatorToken("operator-1", ["export:read"] as AuthScope[]);

  const identity = await provider.authenticate(mockRequest(`Bearer ${token}x`));
  assert.equal(identity, null);
});

test("rotation overlap: two keys with the same name can both be active", async () => {
  const { key: oldKey, entry: oldEntry } = generateApiKey("gateway-prod", ["usage:write"]);
  const { key: newKey, entry: newEntry } = generateApiKey("gateway-prod", ["usage:write", "attest:write"]);

  const provider = buildProvider([oldEntry, newEntry]);
  const oldIdentity = await provider.authenticate(mockRequest(`ApiKey ${oldKey}`));
  const newIdentity = await provider.authenticate(mockRequest(`ApiKey ${newKey}`));

  assert.notEqual(oldIdentity, null);
  assert.notEqual(newIdentity, null);
  assert.deepEqual(oldIdentity!.scopes, ["usage:write"]);
  assert.deepEqual(newIdentity!.scopes, ["usage:write", "attest:write"]);
});

test("parseApiKeyStore handles empty and populated JSON", () => {
  assert.deepEqual(parseApiKeyStore(""), []);
  assert.deepEqual(parseApiKeyStore("[]"), []);

  const { entry } = generateApiKey("gateway-prod", ["usage:write"]);
  const parsed = parseApiKeyStore(JSON.stringify([entry]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "gateway-prod");
});

test("hashApiKeySecret produces deterministic output for a fixed salt", () => {
  const salt = Buffer.from("fixed-salt-16b");
  const a = hashApiKeySecret("same-secret", salt);
  const b = hashApiKeySecret("same-secret", salt);
  assert.equal(a.hash, b.hash);
  assert.equal(a.salt, b.salt);
});

test("verifyScope checks the request identity", async () => {
  const provider = buildProvider();
  const req = mockRequest();
  req.identity = { type: "operator", subject: "op", scopes: ["export:read"] };

  assert.equal(provider.verifyScope(req, "export:read"), true);
  assert.equal(provider.verifyScope(req, "admin"), false);
});
