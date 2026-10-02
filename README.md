# base-yield-lens

Read-only CLI/library that fetches and summarizes **Base** DeFi pool and lending snapshots (Aerodrome / Aave-style APIs as placeholders with clear TODOs).

> **Not financial advice.** Numbers from placeholder endpoints until you wire real Base-native data sources.

## Stack
- TypeScript + pnpm
- `src/cli.ts` — CLI entry (`pnpm cli` via tsx; built bin is `base-yield-lens` → `dist/cli.js`)
- `src/lib/fetch.ts` — fetch + summarize helpers

## Run
```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify-pack
pnpm cli
pnpm cli -- --help
```

Unknown CLI flags are rejected (exit 1). `--help` / `-h` print usage and exit 0.

After `pnpm build`, the package bin is available as `base-yield-lens` (points at `dist/cli.js`). `pnpm verify-pack` runs `npm pack` and asserts `dist/cli.js` + `dist/lib/fetch.js` are present (and `src/`/`tests/`/`scripts/` are not), so the `files:["dist"]` publish surface cannot regress.

Optional: `YIELD_LENS_BASE_URL=https://your-api.example/base-defi`

Blank or whitespace-only `YIELD_LENS_BASE_URL` falls back to the built-in placeholder base. Trailing slashes on the base URL are stripped so `/pools` and `/lending` paths do not double. Non-blank values must be absolute **https** URLs with a host and without embedded credentials (`user:pass@`); localhost / private-network / bracketed IPv6 ULA hosts are rejected; query strings and hashes are rejected (they would break `/pools` and `/lending` path joining); otherwise the CLI exits with a clear error.

When the API is unreachable, returns non-OK, sends malformed JSON, or a non-array body, the CLI still prints a summary with **empty** pools/lending arrays (offline-friendly fallback) plus the disclaimer about placeholder APIs. Null/non-object array elements are dropped; missing or blank string labels render as `?`. Non-finite (or non-number) numeric fields render as `?` instead of `NaN`.

## Scope
- Base chain focus
- No signing / no transactions
- Honest scaffolding for a caretaker agent to grow

MIT
