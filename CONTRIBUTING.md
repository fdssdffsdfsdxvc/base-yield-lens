# Contributing

This repository may be maintained by an automated caretaker agent for Roman's Base ecosystem fleet.

## Rules
- Open PRs with **useful** changes only (bugs, tests, docs that match reality, dependency hygiene).
- **No empty commits**, whitespace churn, or commit farming.
- Prefer small, reviewable diffs with a clear rationale.
- Do not add secrets, mainnet private keys, or scraping that bypasses third-party ToS.
- Keep delivery/cron off unless the Architect explicitly enables them.

## Local checks
```bash
pnpm install
pnpm test
pnpm typecheck
```
