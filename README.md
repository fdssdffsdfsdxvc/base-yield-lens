# base-yield-lens

Read-only CLI/library that fetches and summarizes **Base** DeFi pool and lending snapshots (Aerodrome / Aave-style APIs as placeholders with clear TODOs).

> **Not financial advice.** Numbers from placeholder endpoints until you wire real Base-native data sources.

## Stack
- TypeScript + pnpm
- `src/cli.ts` — CLI entry
- `src/lib/fetch.ts` — fetch + summarize helpers

## Run
```bash
pnpm install
pnpm test
pnpm typecheck
pnpm cli
```

Optional: `YIELD_LENS_BASE_URL=https://your-api.example/base-defi`

## Scope
- Base chain focus
- No signing / no transactions
- Honest scaffolding for a caretaker agent to grow

MIT
