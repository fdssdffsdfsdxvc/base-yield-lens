/**
 * Placeholder fetch layer for Base DeFi snapshots.
 * TODO: wire real Aerodrome / Aave Base subgraph or REST endpoints.
 * Keep this read-only — no signing, no transactions.
 */

export type PoolSnapshot = {
  protocol: string;
  poolId: string;
  symbol: string;
  tvlUsd: number;
  aprPct: number;
  asOf: string;
};

export type LendingSnapshot = {
  protocol: string;
  market: string;
  supplyApyPct: number;
  borrowApyPct: number;
  asOf: string;
};

export type YieldLensSummary = {
  chain: "base";
  pools: PoolSnapshot[];
  lending: LendingSnapshot[];
  fetchedAt: string;
};

const DEFAULT_BASE = "https://api.example.invalid/base-defi";

/**
 * If hostname is IPv4-mapped IPv6 (::ffff:…), return the embedded IPv4 string.
 * Node URL.hostname often rewrites dotted form to two hextets ("[::ffff:7f00:1]").
 */
export function ipv4MappedAddress(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(h);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

/** True for localhost / loopback / 0.0.0.0\/8 / RFC1918 / CGNAT / multicast / reserved 240/4 / IANA special-purpose (192.0.0/24, TEST-NETs, 198.18/15) / link-local / IPv6 ULA / .local/.localhost/.internal. */
export function isNonPublicHostname(hostname: string): boolean {
  // Node may keep brackets on IPv6 hostnames ("[fd12::1]").
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const mapped = ipv4MappedAddress(h);
  if (mapped) return isNonPublicHostname(mapped);
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::" ||
    h === "::1"
  ) {
    return true;
  }
  if (h.endsWith(".local") || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (/^127\./.test(h)) return true;
  // "This network" 0.0.0.0/8 (exact 0.0.0.0 already matched above).
  if (/^0\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  // CGNAT / shared address space (RFC 6598) 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(h)) return true;
  // Multicast 224.0.0.0/4, reserved 240.0.0.0/4, and limited broadcast.
  if (/^2(2[4-9]|3\d|4\d|5[0-5])\./.test(h)) return true;
  // IANA special-purpose, not globally reachable: IETF protocol assignments
  // 192.0.0.0/24, TEST-NETs 192.0.2.0/24 / 198.51.100.0/24 / 203.0.113.0/24,
  // benchmarking 198.18.0.0/15 (often used for internal/fake-IP DNS).
  if (/^192\.0\.[02]\./.test(h)) return true;
  if (/^198\.(1[89])\./.test(h) || /^198\.51\.100\./.test(h)) return true;
  if (/^203\.0\.113\./.test(h)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]*:/i.test(h) || /^fe[89ab][0-9a-f]*:/i.test(h)) {
    return true;
  }
  return false;
}

/**
 * Mask URL userinfo (`user:pass@`) so error messages never echo secrets to
 * stderr/logs. Works on unparseable input too (regex, not URL parsing).
 */
export function redactUrlCredentials(url: string): string {
  // WHATWG URL accepts "https:u:p@h" and backslashes for special schemes too.
  return url.replace(/^(\s*[a-z][a-z0-9+.-]*:[\/\\]*)[^/\\?#]*@/i, "$1***@");
}

/**
 * Public https API root: https only, non-empty host, no embedded credentials,
 * no localhost/private hosts, no query/hash (path join uses `${base}/pools`).
 * Used for YIELD_LENS_BASE_URL after blank-check + trailing-slash strip.
 */
export function assertPublicHttpsBaseUrl(url: string): void {
  const shown = redactUrlCredentials(url);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`YIELD_LENS_BASE_URL must be a valid https URL: ${shown}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`YIELD_LENS_BASE_URL must be https: ${shown}`);
  }
  if (!parsed.hostname) {
    throw new Error(`YIELD_LENS_BASE_URL must include a host: ${shown}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`YIELD_LENS_BASE_URL must not embed credentials: ${shown}`);
  }
  if (isNonPublicHostname(parsed.hostname)) {
    throw new Error(`YIELD_LENS_BASE_URL must not target a private host: ${shown}`);
  }
  // URL.search/hash are "" for a bare trailing "?" or "#", which would still
  // turn `${base}/pools` into a query/fragment; check the raw string too.
  if (parsed.search || parsed.hash || /[?#]/.test(url)) {
    throw new Error(
      `YIELD_LENS_BASE_URL must not include query or hash: ${shown}`,
    );
  }
}

/** Blank / whitespace / trailing slashes → DEFAULT_BASE (or trimmed https root). */
export function resolveBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim() ?? "";
  if (!trimmed) return DEFAULT_BASE;
  const stripped = trimmed.replace(/\/+$/, "");
  assertPublicHttpsBaseUrl(stripped);
  return stripped;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  // Arrays are objects in JS; reject them so nested lists do not become junk "?" rows.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * C0/DEL/C1 controls (ANSI escapes, CR/LF, BEL) and bidi overrides. Labels come
 * from an untrusted API and are printed to a terminal: an ESC sequence could
 * recolor/clear the screen, and CR/LF could forge extra summary lines.
 */
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g;

/** Non-empty string label (controls → space, trimmed), else "?" (avoids "undefined"/"null" in CLI output). */
export function fmtLabel(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.replace(UNSAFE_LABEL_CHARS, " ").trim();
    if (trimmed) return trimmed;
  }
  return "?";
}

/**
 * Coerce metrics for display. Numbers pass through (NaN/±Infinity → "?" via fmtNum).
 * Non-empty numeric strings are accepted; booleans/arrays/objects/blank → NaN.
 */
function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function asOfString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Drop nulls / non-objects / arrays; coerce fields so formatSummary never crashes. */
export function normalizePools(value: unknown): PoolSnapshot[] {
  return asArray(value)
    .filter(isRecord)
    .map((v) => ({
      protocol: fmtLabel(v.protocol),
      poolId: fmtLabel(v.poolId),
      symbol: fmtLabel(v.symbol),
      tvlUsd: asNumber(v.tvlUsd),
      aprPct: asNumber(v.aprPct),
      asOf: asOfString(v.asOf),
    }));
}

export function normalizeLending(value: unknown): LendingSnapshot[] {
  return asArray(value)
    .filter(isRecord)
    .map((v) => ({
      protocol: fmtLabel(v.protocol),
      market: fmtLabel(v.market),
      supplyApyPct: asNumber(v.supplyApyPct),
      borrowApyPct: asNumber(v.borrowApyPct),
      asOf: asOfString(v.asOf),
    }));
}

function fmtNum(n: number, digits: number): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

/** Per-request timeout; Node fetch has no overall deadline (undici waits ~5 min). */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    // Following redirects would bypass assertPublicHttpsBaseUrl (a public https
    // root could 30x to http:// or a private/metadata host). Treat as failure.
    redirect: "error",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

/** Summarize placeholder Aerodrome-style pools + Aave-style markets. */
export async function summarizeYields(opts?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<YieldLensSummary> {
  const baseUrl = resolveBaseUrl(opts?.baseUrl);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  // TODOs point at real integrations; stubs keep the CLI useful offline.
  // Non-array / malformed JSON / null elements must not crash formatSummary later.
  // A hung endpoint times out (AbortSignal) and falls back to [] like other failures.
  const pools = await fetchJson<unknown>(`${baseUrl}/pools`, fetchImpl, timeoutMs)
    .then((v) => normalizePools(v))
    .catch(() => [] as PoolSnapshot[]);
  const lending = await fetchJson<unknown>(`${baseUrl}/lending`, fetchImpl, timeoutMs)
    .then((v) => normalizeLending(v))
    .catch(() => [] as LendingSnapshot[]);

  return {
    chain: "base",
    pools,
    lending,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatSummary(s: YieldLensSummary): string {
  const lines = [
    `Base yield lens @ ${s.fetchedAt}`,
    `Pools: ${s.pools.length}`,
    ...s.pools.map(
      (p) =>
        `  - [${fmtLabel(p.protocol)}] ${fmtLabel(p.symbol)} TVL=$${fmtNum(p.tvlUsd, 0)} APR=${fmtNum(p.aprPct, 2)}%`,
    ),
    `Lending: ${s.lending.length}`,
    ...s.lending.map(
      (m) =>
        `  - [${fmtLabel(m.protocol)}] ${fmtLabel(m.market)} supply=${fmtNum(m.supplyApyPct, 2)}% borrow=${fmtNum(m.borrowApyPct, 2)}%`,
    ),
  ];
  return lines.join("\n");
}
