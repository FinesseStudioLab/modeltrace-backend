# ModelTrace — Backend API (Stellar / Soroban integration)

The trusted sidecar for AI gateways and enterprises: meter usage, prepare Soroban settlements, and export audit evidence—without putting RPC secrets or signing keys in the browser.

---

## 🎯 What is this service?

This **Fastify** service is the **integration and policy edge** for ModelTrace. The Soroban contracts (`audit-registry`, `usage-meter`, `payment-router`) encode **rules** on-chain; this API encodes **who may invoke what**, **when**, and **with which credentials**. It is how inference vendors connect billing pipelines, how enterprises pull tamper-evident exports for procurement, and how you attach webhooks when usage crosses thresholds—all without exposing Horizon URLs or custodial keys to `apps/web`.

---

## ❓ Problems the **protocol** solves (whole repo)

These come from the [root README](../../README.md) — shared context for why Stellar/Soroban exists here:

- AI procurement is scaling faster than **governance**; teams cannot consistently prove model version, region, or policy for a given output.
- Enterprises and regulated buyers need **audit trails** that survive vendor churn and spreadsheet exports.
- Usage-based billing for inference often lacks a **shared neutral layer**, increasing disputes between buyers and providers.

---

## 🛠️ Problems **this API** solves specifically

The smart contracts hold **truth on-chain**; they cannot safely hold ERP passwords, IoT vendor keys, bulk files, or cron jobs. That is this service’s job:

- **Secrets**: Soroban RPC URLs, signing keys, and vendor API tokens must never ship in `NEXT_PUBLIC_*` env vars.
- **Orchestration**: Meter aggregation, tier rollover, and dispute windows often need server-side scheduling and idempotency.
- **Compliance exports**: Large CSV/PDF audit bundles and SIEM hooks belong on the server, not in client bundles.
- **Gateway integration**: Your inference proxy authenticates to **this** API; the API validates quota then prepares chain-facing work.

---

## ✅ Protocol goals this backend helps achieve

- Register **signed attestations** of inference events tied to policy and pricing tiers.
- Support **metered settlement** with dispute windows and programmable payout logic on Soroban.
- Provide **operator-grade** dashboards and exports suitable for procurement and compliance reviews.
- Stay interoperable with existing inference gateways—ModelTrace is a **rail**, not a replacement model host.

---

## ✨ Capabilities this backend enables (production roadmap)

- **Usage ingestion**: Authenticated endpoints for gateways to POST meter events (validated before attestations hit Soroban).
- **Simulate / submit**: Optional server-side transaction preparation for enterprises that forbid browser signing.
- **Settlement hooks**: Webhooks when escrow state changes—plug into ERP/AP systems.
- **Audit export jobs**: Async generation of evidence packs keyed by buyer policy ID.
- **Rate limits & API keys**: Tenant-scoped keys for providers vs buyers vs auditors.

---

## 🔗 Soroban crates → API responsibilities

| Crate | What the HTTP layer typically does |
| ----- | ---------------------------------- |
| `audit-registry` | Receive signed inference payloads from trusted gateways; validate schema; forward to simulation/submit pipeline. |
| `usage-meter` | Aggregate billable units server-side where needed; sync quota state with contract reads/writes. |
| `payment-router` | Prepare payout/dispute transactions; reconcile off-chain invoices with on-chain escrow releases. |

---

## 🏗️ Architecture & stack

| Layer | Choice |
| ----- | ------ |
| HTTP framework | **Fastify** 5 — low overhead, schema-friendly |
| Language | **TypeScript** (strict, ESM, `verbatimModuleSyntax`) |
| Config | **Zod** parsing in `src/config/env.ts` |
| Blockchain | **Stellar** Horizon + **Soroban** RPC (server-side keys only) |
| Consumers | [`apps/web`](../web/README.md), partner systems, cron workers |

---

## 📁 Package layout

```
apps/backend/
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts              # Fastify bootstrap, CORS, route registration
    ├── config/env.ts         # Typed environment
    └── routes/
        ├── health.ts         # GET /health
        └── v1/index.ts       # Versioned API surface (expand here)
```

---

## 🚀 Quick start

### Prerequisites

- **Node.js** 20.x or **22.x** (LTS)
- npm (or pnpm/yarn per org standard)

### Install & run

```bash
cd apps/backend
npm install
cp .env.example .env
# Edit .env — see tables below
npm run dev
```

Default: **http://localhost:8080** · Health: **GET** `/health` · Meta: **GET** `/api/v1/meta`

### Run with the Next.js frontend

```bash
# Terminal A — API
cd apps/backend && npm run dev

# Terminal B — Web
cd apps/web && npm install && npm run dev
```

Set `CORS_ORIGIN` in `.env` to match the web origin (e.g. `http://localhost:3000`).

---

## 📜 Scripts

| Command | Purpose |
| ------- | ------- |
| `npm install` | Install dependencies |
| `npm run dev` | `tsx watch` — reload on change |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm run lint` | `tsc --noEmit` typecheck |

---

## 🔐 Environment variables

### Baseline (implemented)

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NODE_ENV` | `development` | Environment name |
| `PORT` | `8080` | Listen port |
| `API_PREFIX` | `/api/v1` | Prefix for versioned routes |
| `CORS_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS |

### Production / integration (plan — **do not commit secrets**)

| Variable | Example | Purpose |
| -------- | ------- | ------- |
| `SOROBAN_RPC_URL` | `https://…` | RPC endpoint for simulate/submit (server-side only). |
| `HORIZON_URL` | `https://…` | Horizon for historical reads when building audit bundles. |
| `SIGNING_SEED` / KMS | (secret) | Custodial or semi-custodial signing—prefer KMS/Vault in production. |
| `MODELTRACE_GATEWAY_HMAC_SECRET` | (secret) | Authenticate inference gateway POSTs. |

---

## 🔌 HTTP surface

### Implemented (scaffold)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Liveness for load balancers & CI |
| GET | `/api/v1/meta` | Service name / version |

### Planned themes (domain routes — implement under `src/routes/v1/`)

- `POST /api/v1/meter/events` — idempotent usage rows from inference gateways.
- `POST /api/v1/settlement/simulate` — dry-run Soroban footprint before submit.
- `GET /api/v1/audit/export/:jobId` — poll async compliance export jobs.
- `POST /api/v1/webhooks/register` — outbound delivery for billing systems.

---

## 🧪 Testing & quality

```bash
npm run lint
```

CI should mirror this (see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

Add **contract integration tests** in the Rust workspace and **API integration tests** (e.g. `vitest` + `supertest`) as routes grow.

---

## 🚢 Deployment notes

- Run behind TLS termination (load balancer or reverse proxy).
- Store signing keys in **KMS/HSM**, never in repo.
- Restrict Soroban RPC by IP allowlist or private gateway when possible.
- Emit structured logs (JSON) with **request IDs** for regulator audits (especially MediProof / CivicLedger / ReliefFlow).

---

## 🤝 Contributing

See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md). Contract changes must stay aligned with this API’s eventual routes and [`../../docs/SITE_MAP.md`](../../docs/SITE_MAP.md).

---

## 📄 License

Match the repository license (Apache-2.0 suggested for OSS grants — confirm per org).

---

## 📞 Support & related docs

| Doc | Link |
| --- | ---- |
| Monorepo overview | [`../../README.md`](../../README.md) |
| Frontend | [`../web/README.md`](../web/README.md) |
| Architecture notes | [`../../docs/layout-plan.md`](../../docs/layout-plan.md) |
| Milestones → issues | [`../../docs/milestones-issues.md`](../../docs/milestones-issues.md) |

---

**Package:** `modeltrace-api` · **Slug:** `modeltrace`

// patch: 2026-06-10T06:00:00

// patch: 2026-06-22T18:00:00

// patch: 2026-06-24T15:00:00

// patch: 2026-06-29T00:00:00
