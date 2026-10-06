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

Unknown CLI flags and empty/whitespace-only arguments are rejected (exit 1). `--help` / `-h` print usage and exit 0. A bare `--` end-of-options marker (as forwarded by `pnpm cli -- --help`) is ignored.

After `pnpm build`, the package bin is available as `base-yield-lens` (points at `dist/cli.js`). `main`/`types`/`exports` point at `dist/lib/fetch.js` for programmatic use. `pnpm verify-pack` runs `npm pack` and asserts `dist/cli.js` + `dist/cliArgs.js` + `dist/lib/fetch.js` + `.d.ts` plus `LICENSE`/`README.md` are present (and `src/`/`tests/`/`scripts/` are not), and that packed `bin`/`main`/`types`/`exports` still point at `dist` with `files` including `dist`, `license` is MIT, `engines.node` is `>=18`, and `prepack` runs the build. Because of `prepack`, `npm pack` / `npm publish` (and `pnpm verify-pack`) build `dist/` first, so a clean checkout never ships a tarball whose bin points at a missing file.

Optional: `YIELD_LENS_BASE_URL=https://your-api.example/base-defi`

Blank or whitespace-only `YIELD_LENS_BASE_URL` falls back to the built-in placeholder base. Trailing slashes on the base URL are stripped so `/pools` and `/lending` paths do not double. Non-blank values must be absolute **https** URLs with a host and without embedded credentials (`user:pass@`); localhost / `.localhost` / `.internal` / private-network / 0.0.0.0/8 / multicast / CGNAT (100.64/10) / bracketed IPv6 ULA / unspecified `::` / IPv4-mapped IPv6 (`::ffff:`) private hosts are rejected; query strings and hashes are rejected, including a bare trailing `?` or `#` (they would break `/pools` and `/lending` path joining); otherwise the CLI exits with a clear error. Error messages mask any embedded `user:pass@` as `***@` so secrets are not echoed to stderr/logs.

When the API is unreachable, hangs past the per-request timeout (10 s, `DEFAULT_FETCH_TIMEOUT_MS`; override via `summarizeYields({ timeoutMs })`), returns non-OK, redirects (30x is not followed, so a redirect cannot bypass the https/private-host checks above), sends malformed JSON, or a non-array body, the CLI still prints a summary with **empty** pools/lending arrays (offline-friendly fallback) plus the disclaimer about placeholder APIs. Null/non-object/array elements are dropped; missing or blank string labels render as `?`; surrounding whitespace on labels is trimmed, and control characters (ANSI escapes, CR/LF, BEL, C1, bidi overrides) inside API labels are replaced with spaces so an upstream response cannot rewrite the terminal or forge extra summary lines. Finite numeric strings are accepted for metrics; non-finite (or non-numeric) fields render as `?` instead of `NaN`.

## Scope
- Base chain focus
- No signing / no transactions
- Honest scaffolding for a caretaker agent to grow

MIT
