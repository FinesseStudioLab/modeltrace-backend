import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercises the module's actual top-level behavior (`loadEnv()` calling
// `process.exit`) in a real subprocess — this cannot be tested in-process
// without killing the test runner itself. Runs the *compiled* sibling
// `env.js` (this file compiles to dist/config/env.exit.test.js, so `env.js`
// sits right next to it) directly with `node`.
const compiledEnvPath = fileURLToPath(new URL("./env.js", import.meta.url));

const validContractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const validEnv = {
  PATH: process.env.PATH ?? "",
  NODE_ENV: "production",
  STELLAR_NETWORK: "testnet",
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  AUDIT_REGISTRY_CONTRACT_ID: validContractId,
  USAGE_METER_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  PAYMENT_ROUTER_CONTRACT_ID: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  CORS_ORIGIN: "https://app.example.com",
  SIGNING_ENV_SECRET_KEY: "S-THIS-IS-THE-SECRET-VALUE",
};

// A cwd with no .env file, so `dotenv/config` (imported at the top of
// env.ts) has nothing to load and can't leak an unrelated local .env into
// the subprocess's environment.
const emptyCwd = mkdtempSync(join(tmpdir(), "modeltrace-env-test-"));

function runEnvModule(env: Record<string, string>) {
  return spawnSync(process.execPath, [compiledEnvPath], {
    cwd: emptyCwd,
    env,
    encoding: "utf8",
  });
}

test("valid environment: exits zero and logs the resolved config, without the secret value", () => {
  const result = runEnvModule(validEnv);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Resolved configuration:/);
  assert.match(result.stdout, /"provider": "null"/);
  assert.doesNotMatch(result.stdout, /S-THIS-IS-THE-SECRET-VALUE/);
  assert.match(result.stdout, /\[redacted\]/);
});

test("invalid environment: exits non-zero with a readable, per-variable message", () => {
  const { STELLAR_NETWORK: _drop, ...withoutNetwork } = validEnv;
  const result = runEnvModule(withoutNetwork);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid environment configuration:/);
  assert.match(result.stderr, /STELLAR_NETWORK/);
  // Never a raw ZodError dump: no uncaught-exception stack trace, no JSON blob.
  assert.doesNotMatch(result.stderr, /ZodError/);
  assert.doesNotMatch(result.stderr, /"code":\s*"invalid_type"/);
});

test("invalid environment: never echoes the offending value, even for an enum typo", () => {
  const result = runEnvModule({ ...validEnv, STELLAR_NETWORK: "not-a-real-network-secret-ish" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STELLAR_NETWORK/);
  assert.doesNotMatch(result.stderr, /not-a-real-network-secret-ish/);
});
