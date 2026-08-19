# Contributing to modeltrace-backend

The Fastify API is the trusted edge of ModelTrace: it talks to Soroban RPC,
ingests gateway webhooks, and runs privileged workflows so that secrets never
reach the browser.

## Prerequisites

- Node.js 20+

## Local workflow

```bash
npm ci
cp .env.example .env
npm run dev        # tsx watch on src/index.ts

npm run lint       # tsc --noEmit
npm run build      # tsc
```

Lint and build must pass before you open a PR — CI runs exactly these.

## Review bar

- **No secrets in responses, logs, or errors.** Signing keys and RPC credentials
  stay server-side; scrub them from logger output explicitly.
- **Validate every input at the boundary** with the existing `zod` setup, and
  derive the TypeScript type from the schema rather than declaring it twice.
- **Every route states its auth posture.** Public, gateway-authenticated, or
  admin — if it is public, say why that is safe.
- **Errors are typed and mapped.** No raw exception text to clients; no
  `catch {}` that swallows a failure silently.
- **Anything that writes on-chain is idempotent.** Webhooks retry; a replayed
  delivery must not double-meter or double-pay.

## Commits and PRs

Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). Keep PRs
scoped to one concern and open a draft early for anything architectural.
