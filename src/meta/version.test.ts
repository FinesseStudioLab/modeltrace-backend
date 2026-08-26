import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { getMetaInfo, type MetaConfig } from "./version.js";

const config: MetaConfig = {
  stellar: {
    network: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    contracts: {
      auditRegistry: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      usageMeter: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      paymentRouter: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    },
  },
};

test("version is sourced from package.json, not a literal", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };
  const info = getMetaInfo(config, {});
  assert.equal(info.version, pkg.version);
});

test("build commit and time default to 'unknown' when not injected", () => {
  const info = getMetaInfo(config, {});
  assert.equal(info.build.commit, "unknown");
  assert.equal(info.build.builtAt, "unknown");
});

test("build commit and time are read from the environment when present", () => {
  const info = getMetaInfo(config, {
    BUILD_SHA: "abc123",
    BUILD_TIME: "2026-08-25T00:00:00.000Z",
  });
  assert.equal(info.build.commit, "abc123");
  assert.equal(info.build.builtAt, "2026-08-25T00:00:00.000Z");
});

test("reports the configured network and contract addresses", () => {
  const info = getMetaInfo(config, {});
  assert.equal(info.network.stellarNetwork, "testnet");
  assert.equal(info.network.contracts.auditRegistry, config.stellar.contracts.auditRegistry);
});

test("description no longer reads as a scaffold", () => {
  const info = getMetaInfo(config, {});
  assert.ok(!/scaffold/i.test(info.description));
});
