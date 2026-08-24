import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NullSigningKeyProvider,
  REDACTED,
  redactSecrets,
  resolveSigningKeyProvider,
  SigningEvent,
  SigningUnavailableError,
} from "./index.js";

const silent = () => {};
const SEED = "SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
const looksLikeSeed = (value: string) => /\bS[A-Z2-7]{55}\b/.test(value);

test("redaction keeps ordinary values", () => {
  const out = redactSecrets({ service: "api", port: 8080 }) as Record<string, unknown>;
  assert.equal(out.service, "api");
  assert.equal(out.port, 8080);
});

test("redaction removes values under secret-looking key names", () => {
  const out = redactSecrets({
    SIGNING_ENV_SECRET_KEY: SEED,
    nested: { apiKey: "abc", authorization: "Bearer xyz" },
  }) as Record<string, Record<string, unknown>>;

  assert.equal(out.SIGNING_ENV_SECRET_KEY, REDACTED);
  assert.equal(out.nested.apiKey, REDACTED);
  assert.equal(out.nested.authorization, REDACTED);
});

test("redaction scrubs a Stellar seed that arrived under an innocuous name", () => {
  // The case that matters most: a secret nobody labelled as one.
  const out = redactSecrets({ note: `seed is ${SEED} here` }) as Record<string, string>;
  assert.ok(!looksLikeSeed(out.note));
});

test("redaction survives a cycle rather than throwing", () => {
  // A Fastify error can reference the request that produced it. A serializer
  // that throws takes the log line, and often the request, with it.
  const request: Record<string, unknown> = { url: "/health" };
  request.self = request;
  const out = redactSecrets(request) as Record<string, unknown>;
  assert.equal(out.self, "[circular]");
});

test("redaction preserves error fields while scrubbing them", () => {
  const out = redactSecrets(new Error(`failed with ${SEED}`)) as Record<string, string>;
  assert.equal(out.name, "Error");
  assert.ok(!looksLikeSeed(out.message));
});

test("the default provider is null and refuses to sign", async () => {
  const provider = resolveSigningKeyProvider(
    { provider: "null", nodeEnv: "development" },
    silent,
  );
  assert.ok(provider instanceof NullSigningKeyProvider);
  await assert.rejects(() => provider.sign(new Uint8Array(), "attestation"), SigningUnavailableError);
});

test("the env provider is refused outright in production", () => {
  // ADR 0001: the interim risk has a boundary, and this is where it is enforced.
  // A refusal, not a warning — a silent downgrade is noticed after an incident.
  assert.throws(
    () =>
      resolveSigningKeyProvider(
        { provider: "env", envSecret: "x", nodeEnv: "production" },
        silent,
      ),
    /not permitted in production/,
  );
});

test("the env provider warns loudly outside production", () => {
  const events: string[] = [];
  resolveSigningKeyProvider(
    { provider: "env", envSecret: "x", nodeEnv: "development" },
    (event) => events.push(event),
  );
  assert.ok(events.includes(SigningEvent.InterimRiskActive));
});

test("providers refuse to start without the configuration they need", () => {
  assert.throws(
    () => resolveSigningKeyProvider({ provider: "env", nodeEnv: "development" }, silent),
    /SIGNING_ENV_SECRET_KEY/,
  );
  assert.throws(
    () => resolveSigningKeyProvider({ provider: "kms", nodeEnv: "production" }, silent),
    /SIGNING_KMS_KEY_ID/,
  );
});

test("a scope outside the key's permitted set is rejected before signing", async () => {
  const provider = resolveSigningKeyProvider(
    { provider: "kms", kmsKeyId: "test-key", nodeEnv: "production" },
    silent,
  );
  await assert.rejects(
    () => provider.sign(new Uint8Array(), "settlement" as "attestation"),
    /scope not permitted/,
  );
});
