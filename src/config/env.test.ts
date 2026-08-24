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
};

Object.assign(process.env, baseEnv);

const { envSchema, parseEnv } = await import("./env.js");

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

test(".env.example carries every required schema key", () => {
  const schemaKeys = Object.keys(envSchema.shape);
  const optionalKeys = new Set(["SIGNING_KMS_KEY_ID", "SIGNING_ENV_SECRET_KEY"]);
  const exampleKeys = new Set(exampleEnvKeys());

  for (const key of schemaKeys) {
    if (!optionalKeys.has(key)) {
      assert.ok(exampleKeys.has(key), `.env.example is missing ${key}`);
    }
  }
});
