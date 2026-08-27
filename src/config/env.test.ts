import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const baseEnv = {
  NODE_ENV: "test",
  PORT: "8080",
  API_PREFIX: "/api/v1",
  CORS_ORIGIN: "http://localhost:3000",
  STELLAR_NETWORK: "testnet",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  AUDIT_REGISTRY_CONTRACT_ID: validContractId,
  USAGE_METER_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  PAYMENT_ROUTER_CONTRACT_ID: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  SIGNING_PROVIDER: "null",
  RATE_LIMIT_MAX: "100",
  RATE_LIMIT_WINDOW_MS: "60000",
  BODY_LIMIT_BYTES: "1048576",
};

Object.assign(process.env, baseEnv);

const { baseEnvSchema, parseEnv, parseCorsOrigins, resolveCorsOrigins } = await import(
  "./env.js"
);

function exampleEnvKeys(): string[] {
  return readFileSync(".env.example", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]);
}

test("parses Soroban network and contract configuration", () => {
  const parsed = parseEnv(baseEnv);

  assert.equal(parsed.STELLAR_NETWORK, "testnet");
  assert.equal(parsed.SOROBAN_RPC_URL, "https://soroban-testnet.stellar.org");
  assert.equal(parsed.AUDIT_REGISTRY_CONTRACT_ID, validContractId);
});

test("STELLAR_NETWORK is required and has no default", () => {
  const { STELLAR_NETWORK, ...missingNetwork } = baseEnv;
  assert.throws(() => parseEnv(missingNetwork), /STELLAR_NETWORK/);
});

test("Soroban RPC URL must be a URL", () => {
  assert.throws(() => parseEnv({ ...baseEnv, SOROBAN_RPC_URL: "testnet" }), /SOROBAN_RPC_URL/);
});

test("contract IDs must be Soroban contract-shaped strkeys", () => {
  assert.throws(
    () => parseEnv({ ...baseEnv, AUDIT_REGISTRY_CONTRACT_ID: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    /AUDIT_REGISTRY_CONTRACT_ID/,
  );
});

test("CORS_ORIGIN parses a comma-separated list into multiple origins", () => {
  assert.deepEqual(parseCorsOrigins("https://a.example, https://b.example"), [
    "https://a.example",
    "https://b.example",
  ]);
  assert.deepEqual(parseCorsOrigins(undefined), []);
  assert.deepEqual(parseCorsOrigins(""), []);
});

test("resolveCorsOrigins falls back to the dev default outside production", () => {
  assert.deepEqual(resolveCorsOrigins(undefined, "development"), ["http://localhost:3000"]);
  assert.deepEqual(resolveCorsOrigins("https://a.example", "development"), [
    "https://a.example",
  ]);
});

test("production requires CORS_ORIGIN to be set explicitly", () => {
  const { CORS_ORIGIN, ...withoutCors } = baseEnv;
  assert.throws(
    () => parseEnv({ ...withoutCors, NODE_ENV: "production" }),
    /CORS_ORIGIN/,
  );
});

test('production rejects "*" as a CORS origin', () => {
  assert.throws(
    () => parseEnv({ ...baseEnv, NODE_ENV: "production", CORS_ORIGIN: "*" }),
    /CORS_ORIGIN/,
  );
  assert.throws(
    () => parseEnv({ ...baseEnv, NODE_ENV: "production", CORS_ORIGIN: "https://a.example,*" }),
    /CORS_ORIGIN/,
  );
});

test("production accepts an explicit, non-wildcard CORS_ORIGIN", () => {
  const parsed = parseEnv({
    ...baseEnv,
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.example.com",
  });
  assert.equal(parsed.CORS_ORIGIN, "https://app.example.com");
});

test(".env.example carries every required schema key", () => {
  const schemaKeys = Object.keys(baseEnvSchema.shape);
  const optionalKeys = new Set(["SIGNING_KMS_KEY_ID", "SIGNING_ENV_SECRET_KEY"]);
  const exampleKeys = new Set(exampleEnvKeys());

  for (const key of schemaKeys) {
    if (!optionalKeys.has(key)) {
      assert.ok(exampleKeys.has(key), `.env.example is missing ${key}`);
    }
  }
});
