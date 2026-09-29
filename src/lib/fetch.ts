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

/** Blank / whitespace / trailing slashes → DEFAULT_BASE (or trimmed root). */
export function resolveBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim() ?? "";
  if (!trimmed) return DEFAULT_BASE;
  return trimmed.replace(/\/+$/, "");
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Non-empty string label, else "?" (avoids "undefined"/"null" in CLI output). */
export function fmtLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  return "?";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function asOfString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Drop non-objects / nulls; coerce fields so formatSummary never crashes. */
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

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(url, {
    headers: { accept: "application/json" },
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
}): Promise<YieldLensSummary> {
  const baseUrl = resolveBaseUrl(opts?.baseUrl);
  const fetchImpl = opts?.fetchImpl ?? fetch;

  // TODOs point at real integrations; stubs keep the CLI useful offline.
  // Non-array / malformed JSON / null elements must not crash formatSummary later.
  const pools = await fetchJson<unknown>(`${baseUrl}/pools`, fetchImpl)
    .then((v) => normalizePools(v))
    .catch(() => [] as PoolSnapshot[]);
  const lending = await fetchJson<unknown>(`${baseUrl}/lending`, fetchImpl)
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
