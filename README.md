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

CI (GitHub Actions, Node 22 LTS — Node 20 reached end-of-life in April 2026; workflow actions pinned to their Node 24-based majors `actions/checkout@v5`, `actions/setup-node@v5`, `pnpm/action-setup@v5`, each by its immutable full commit SHA so a moved/swapped tag can never introduce arbitrary code into CI; least-privilege `permissions: contents: read` on the workflow) runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm verify-pack` on push/PR to `main` (bump the SHA when upgrading an action).

Dev tooling (vitest 4 / vite 8) needs Node `^20.19` or `>=22.12`; the built CLI/library itself still runs on Node `>=18` (`engines`). Run `pnpm audit` after dependency changes — vitest was bumped from 2.x to `^4.1.11` because 2.x pulled in advisories for vitest, vite, esbuild, tinypool and source-map-js.

`pnpm typecheck` checks `src/` (build config) and also `tests/` + `vitest.config.ts` via `tsconfig.test.json` — vitest itself strips types without checking them.

Unknown CLI flags and empty/whitespace-only arguments are rejected (exit 1). `--help` / `-h` print usage and exit 0. A bare `--` end-of-options marker (as forwarded by `pnpm cli -- --help`) is ignored.

After `pnpm build`, the package bin is available as `base-yield-lens` (points at `dist/cli.js`). `main`/`types`/`exports` point at `dist/lib/fetch.js` for programmatic use. `pnpm verify-pack` runs `npm pack` and asserts `dist/cli.js` + `dist/cliArgs.js` + `dist/lib/fetch.js` + `.d.ts` plus `LICENSE`/`README.md` are present (and `src/`/`tests/`/`scripts/` are not), and that packed `bin`/`main`/`types`/`exports` still point at `dist` with `files` including `dist`, `license` is MIT, `engines.node` is `>=18`, and `prepack` runs the build. Because of `prepack`, `npm pack` / `npm publish` (and `pnpm verify-pack`) build `dist/` first, so a clean checkout never ships a tarball whose bin points at a missing file.

Optional: `YIELD_LENS_BASE_URL=https://your-api.example/base-defi`

Blank or whitespace-only `YIELD_LENS_BASE_URL` falls back to the built-in placeholder base. Trailing slashes on the base URL are stripped so `/pools` and `/lending` paths do not double. Non-blank values must be absolute **https** URLs with a host and without embedded credentials (`user:pass@`); localhost / `.localhost` / `.internal` / `home.arpa` (RFC 8375 special-use domain for home networks) / private-network / 0.0.0.0/8 / multicast (IPv4 224/4, IPv6 `ff00::/8`) / reserved 240/4 / IANA special-purpose (192.0.0/24, TEST-NETs, benchmarking 198.18/15, deprecated 6to4 relay anycast 192.88.99/24, IPv6 documentation prefixes 2001:db8::/32 and 3fff::/20, IPv6 discard-only 100::/64, IPv6 benchmarking 2001:2::/48) / CGNAT (100.64/10) / bracketed IPv6 ULA (`fc00::/7`) / deprecated site-local (`fec0::/10`) / link-local (`fe80::/10`) / unspecified `::` / IPv4-mapped IPv6 (`::ffff:`) / IPv4-translated (`::ffff:0:`) / IPv4-compatible (`::a.b.c.d`) / NAT64 (`64:ff9b::/96`, local-use `64:ff9b:1::/48`) / 6to4 (`2002::/16`, which embeds the IPv4 gateway in hextets 1-2) private hosts are rejected (IPv4 range checks apply to IP literals only, so DNS names like `10.api.example.com` are allowed; the exported `isNonPublicHostname` canonicalizes raw input the way `new URL()` does, so shorthand/hex/octal/integer IPv4 such as `127.1` or `2130706433` and uncompressed IPv6 such as `0:0:0:0:0:0:0:1` are caught too, and an optional authority port (`127.0.0.1:8080`, `[fd12::1]:8080`, as in a `Host` header or `URL.host`) is ignored so the host itself is still checked; an RFC 4007 scoped IPv6 literal such as `::1%lo` or `[ff02::1%25eth0]` is classified by its address, since the zone id only names the local interface and would otherwise make the literal unparseable and slip past the checks); query strings and hashes are rejected, including a bare trailing `?` or `#` (they would break `/pools` and `/lending` path joining); otherwise the CLI exits with a clear error. Error messages mask any embedded `user:pass@` as `***@` (even when a `?`, `#`, or `\` delimiter sits inside a malformed password, which would otherwise abort the match and print the raw, unparseable URL) so secrets are not echoed to stderr/logs (also applied to `fetchJson` HTTP error messages, since it is exported).

When the API is unreachable, hangs past the per-request timeout (10 s, `DEFAULT_FETCH_TIMEOUT_MS`; override via `summarizeYields({ timeoutMs })`), returns non-OK, redirects (30x is not followed, so a redirect cannot bypass the https/private-host checks above), sends malformed JSON, or a non-array body, the CLI still prints a summary with **empty** pools/lending arrays (offline-friendly fallback) plus the disclaimer about placeholder APIs. Null/non-object/array elements are dropped; missing or blank string labels render as `?`; surrounding whitespace on labels is trimmed, and control characters (ANSI escapes, CR/LF, BEL, C1, bidi overrides) inside API labels are replaced with spaces so an upstream response cannot rewrite the terminal or forge extra summary lines. Labels are also hard-capped at 128 characters (`MAX_LABEL_LENGTH`, truncated with `…`, never mid-surrogate-pair so emoji/astral labels do not become U+FFFD mojibake) so a huge upstream string cannot flood stdout/logs. Finite decimal numeric strings are accepted for metrics (hex/octal/binary strings such as `0x…` raw on-chain quantities are not reinterpreted as decimal); non-finite (or non-numeric) fields render as `?` instead of `NaN`.

## Scope
- Base chain focus
- No signing / no transactions
- Honest scaffolding for a caretaker agent to grow

MIT
