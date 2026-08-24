# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main`  | ✅ Yes     |

Only the current `main` branch receives security fixes. No LTS or versioned releases are supported at this stage.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing **devsolex6@gmail.com** with the subject line:

```
[SECURITY] modeltrace-backend — <brief description>
```

Include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept (if safe to share).
- Affected component (e.g., route, dependency, CI pipeline).
- Your GitHub handle or preferred contact for follow-up.

---

## Response Timeline

| Stage | Target SLA |
| ----- | ---------- |
| Acknowledgement | Within **48 hours** of receiving the report |
| Initial triage (severity classification) | Within **5 business days** |
| Fix for **Critical** severity | Within **7 days** of confirmed triage |
| Fix for **High** severity | Within **14 days** of confirmed triage |
| Fix for **Medium / Low** severity | Next regular release cycle (≤ 30 days) |
| Public disclosure | After patch is merged and released; coordinated with the reporter |

If a fix cannot be delivered within the above windows, we will notify the reporter with an updated timeline and interim mitigations.

---

## Dependency Scanning

This project uses:

- **Dependabot** — weekly PRs for npm and GitHub Actions updates (minor/patch grouped; majors arrive separately).
- **`npm audit`** — runs in CI on every push and pull request; the build fails on `high` or `critical` advisories.
- **GitHub Secret Scanning** — push protection is enabled; commits containing detected secrets are blocked.

### Pinned GitHub Actions

All GitHub Actions in `.github/workflows/` are pinned to immutable commit SHAs rather than floating version tags. This prevents supply-chain attacks where a tag is repointed to malicious code. Dependabot keeps the SHA pins up to date automatically.

---

## Scope

The following are **in scope** for security reports:

- Authentication bypass or privilege escalation in API routes.
- Secrets or signing keys exposed via logs, responses, or environment variables.
- Injection vulnerabilities (SQL, command, SSRF, etc.) in any route or integration layer.
- Soroban / Stellar transaction manipulation (incorrect fee, replay, signature bypass).
- Supply-chain issues in npm or GitHub Actions dependencies.

The following are **out of scope**:

- Issues in dependencies that already have a published advisory and an open Dependabot PR.
- Theoretical vulnerabilities with no practical exploit path.
- Social engineering or phishing attacks.

---

## Acknowledgements

Security reporters who responsibly disclose confirmed vulnerabilities will be credited in the relevant release notes (unless they prefer to remain anonymous).
