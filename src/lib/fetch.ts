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
  const baseUrl = opts?.baseUrl ?? DEFAULT_BASE;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  // TODOs point at real integrations; stubs keep the CLI useful offline.
  const pools = await fetchJson<PoolSnapshot[]>(
    `${baseUrl}/pools`,
    fetchImpl,
  ).catch(() => [] as PoolSnapshot[]);
  const lending = await fetchJson<LendingSnapshot[]>(
    `${baseUrl}/lending`,
    fetchImpl,
  ).catch(() => [] as LendingSnapshot[]);

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
        `  - [${p.protocol}] ${p.symbol} TVL=$${p.tvlUsd.toFixed(0)} APR=${p.aprPct.toFixed(2)}%`,
    ),
    `Lending: ${s.lending.length}`,
    ...s.lending.map(
      (m) =>
        `  - [${m.protocol}] ${m.market} supply=${m.supplyApyPct.toFixed(2)}% borrow=${m.borrowApyPct.toFixed(2)}%`,
    ),
  ];
  return lines.join("\n");
}
