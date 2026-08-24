# ADR 0001 — Soroban signing key custody

- **Status:** Accepted
- **Date:** 2026-08-24
- **Milestone:** M3 — Settle and dispute
- **Supersedes:** nothing (first decision on this axis)

## Context

`modeltrace-api` is the integration and policy edge between AI gateways and the
Soroban contracts. Two very different kinds of chain writes pass through it:

| | Attestation writes | Settlement / value movement |
|---|---|---|
| Frequency | High — one per metered inference batch | Low — per billing period or dispute resolution |
| Value at risk if forged | Audit-record integrity | **Funds** |
| Latency tolerance | Low (must not block metering) | High (a human or scheduled process is already in the loop) |
| Needs a human in the loop | No | Yes, or an explicitly delegated policy |

Before this ADR there was no written policy on where a signing key lives, who may
use it, or what happens when it leaks. The repository has no key handling code
yet, which makes this the cheapest possible moment to decide: every choice below
is a one-line change today and a migration later.

## Options considered

### 1. Backend holds a key for everything

The API server signs and submits all transactions.

Simple, and the only option with no integration friction for gateways. It also
makes the API server a funds-controlling system: an RCE, an SSRF that reaches the
key, a malicious dependency, or a leaked backup all become "attacker can move
customer money." Every subsequent security control on this service would exist to
protect that one capability, and the blast radius never shrinks.

**Rejected.** The convenience is real but it is bought by permanently coupling a
high-traffic HTTP surface to spending authority.

### 2. Backend prepares, client signs — for everything

The server builds unsigned transaction envelopes; the counterparty's wallet signs
and submits.

Strictly safer: the server never holds spending authority, so compromising it
cannot move funds. The cost lands on attestation, which is the high-frequency
path — every metered inference batch would need an interactive signature from a
gateway operator. That is not workable for a metering pipeline, and pushing
gateways toward "just automate the wallet" would recreate option 1 with worse
key hygiene, outside our control.

**Rejected as a blanket policy**, but adopted for the path where it belongs.

### 3. Hybrid — unsigned envelopes for value, a scoped service key for attestation

Settlement and any other value movement follow option 2. Attestation writes are
signed by a dedicated, low-privilege service key held in a KMS.

The two workloads have opposite risk and latency profiles, so giving them the
same key is what creates the problem in the first place. Splitting them lets each
path take the control that fits it.

**Accepted.**

## Decision

**We adopt option 3.**

1. **Value movement is never signed by this service.** Settlement, refunds, and
   dispute payouts are returned to the caller as unsigned XDR envelopes. The
   service has no key capable of authorizing them, so a full compromise of
   `modeltrace-api` cannot move funds — it can at worst return a *wrong* envelope,
   which the signer's own review and the contract's own authorization checks are
   positioned to catch.
2. **Attestation writes use a scoped service key**, held in a KMS, whose contract
   authorization permits attestation entry points only. Compromise costs
   audit-record integrity for the window before revocation — serious, detectable,
   and recoverable — not funds.
3. **The key is scoped at the contract, not only by convention.** A key that is
   merely "used for" attestation is one code change away from being used for
   settlement. Authorization is enforced on-chain so that the guarantee survives
   our own mistakes.

### Provider model

`SigningKeyProvider` (`src/core/signing/key-provider.ts`) is the only way to
reach a signature. It exposes `sign()` and deliberately does **not** expose the
key material, so no call site can log, serialize, or forward it.

| Provider | Use | Status |
|---|---|---|
| `NullSigningKeyProvider` | Default. Every signing attempt throws. | Active — the correct state until attestation ships |
| `KmsSigningKeyProvider` | Production. Signing happens inside the KMS; the key never enters process memory. | Interface defined, integration deferred to the attestation PR |
| `EnvSigningKeyProvider` | Local development and nothing else. | **Interim risk — see below** |

The default is the null provider on purpose. A service that cannot sign is the
safe default state, and "signing quietly started working because someone set an
env var in staging" is exactly the failure this ADR exists to prevent.

### Interim risk: `EnvSigningKeyProvider`

Reading a key from an environment variable is not acceptable in production. It is
nonetheless the only practical option for local development before KMS
credentials exist, so it is permitted under these conditions:

- **Owner:** backend maintainers (`FinesseStudioLab/modeltrace-backend`)
- **End date:** the attestation-write PR, i.e. before any deployment that signs
  against a public network. Not a calendar date, because the risk does not exist
  until the code path does.
- **Enforcement:** selecting it while `NODE_ENV=production` is a **startup
  failure**, not a warning. Outside production it logs a loud, structured warning
  on every process start so it cannot become invisible.
- **Constraint:** the key it reads must never be an account that holds funds.

## Key hygiene requirements

**Key material never appears in source, logs, or error output.**

- `.env` is git-ignored; `.env.example` carries names and comments only.
- `redactSecrets()` (`src/core/signing/redact.ts`) is applied to the Fastify
  logger's serializers so a secret cannot reach the log stream by being nested in
  a request body, a config dump, or a thrown error's context.
- The provider interface returns signatures, never keys. There is no getter.
- Errors from the signing path are re-thrown with a fixed message; the underlying
  provider error is logged through the redacting serializer rather than being
  propagated to the HTTP response.

## Rotation procedure

Rotation is written down here because a procedure nobody has read is not a
procedure. It is designed to need no downtime: the contract accepts the new key
before the old one is revoked.

1. **Generate** the new keypair inside the KMS. The private key never leaves it.
2. **Authorize** the new public key on the attestation contract as an *additional*
   permitted signer. Both keys are now valid.
3. **Cut over** by pointing `SIGNING_KMS_KEY_ID` at the new key and restarting the
   service. Verify by submitting one attestation and confirming on-chain that it
   carries the new signer.
4. **Observe** for one full metering cycle. Any attestation still arriving under
   the old key means a stale instance is running — find it before continuing.
5. **Revoke** the old public key on the contract.
6. **Destroy** the old key material in the KMS, subject to the retention window
   the audit policy requires.

**Emergency rotation** (suspected compromise) runs the same steps with 5 before 3:
revoke first and accept the attestation gap, because a forged attestation is
worse than a missing one. The gap is backfillable from the metering store; a
forged record is not detectable after the fact.

**Rehearsal:** steps 1–6 are rehearsed on testnet before the first mainnet
deployment, and re-rehearsed whenever the provider changes. The rehearsal is not
optional — an untested rotation procedure fails at exactly the moment it is
needed.

## Alerting

Signing is low-volume and highly patterned, which makes anomalies cheap to spot:

| Signal | Why it matters |
|---|---|
| Any signing attempt while the provider is `null` | Code reached a signing path it should not have |
| `EnvSigningKeyProvider` selected outside development | The interim risk has escaped its boundary |
| Signing rate above the metering rate | Something is signing that is not attestation |
| Any signature for a non-attestation entry point | Scope violation — the on-chain check should have refused first |
| Signing outside the deployment's active region or hours | Credential use from somewhere unexpected |

Each emits a structured log event under `event: "signing.*"` so the alerting rule
is a log query rather than new instrumentation.

## Consequences

**Accepted costs.** Gateways integrating settlement must handle an unsigned
envelope and sign it themselves — real friction, and the reason option 1 is
tempting. We accept it because it is the entire point: the friction is the
security property.

**What this buys.** A full compromise of `modeltrace-api` cannot move funds. That
statement is what lets this service be operated, scaled, and debugged like a
normal API rather than like a custodian.

**What is still open.** The KMS provider is an interface, not an integration; the
attestation PR completes it. Multi-signature and threshold signing for settlement
are out of scope here — this ADR only establishes that this service is not a
signer for value movement.
