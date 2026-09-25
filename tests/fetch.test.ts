import { describe, expect, it, vi } from "vitest";
import {
  fetchJson,
  formatSummary,
  summarizeYields,
} from "../src/lib/fetch.js";

describe("summarizeYields", () => {
  it("builds a Base summary from mocked pool/lending JSON", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "aerodrome",
              poolId: "0xabc",
              symbol: "WETH/USDC",
              tvlUsd: 1_000_000,
              aprPct: 12.5,
              asOf: "2026-09-25T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/lending")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "aave-v3",
              market: "USDC",
              supplyApyPct: 3.1,
              borrowApyPct: 4.2,
              asOf: "2026-09-25T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.chain).toBe("base");
    expect(summary.pools).toHaveLength(1);
    expect(summary.lending[0]?.market).toBe("USDC");
    const text = formatSummary(summary);
    expect(text).toContain("WETH/USDC");
    expect(text).toContain("aave-v3");
  });

  it("returns empty pools/lending when upstream fetch fails (offline CLI)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.chain).toBe("base");
    expect(summary.pools).toEqual([]);
    expect(summary.lending).toEqual([]);
    expect(summary.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(formatSummary(summary)).toContain("Pools: 0");
  });

  it("returns empty arrays when endpoints respond non-OK", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.pools).toEqual([]);
    expect(summary.lending).toEqual([]);
  });
});

describe("fetchJson", () => {
  it("throws a clear HTTP error for non-OK responses", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      fetchJson("https://mock.test/missing", fetchImpl),
    ).rejects.toThrow("HTTP 404 for https://mock.test/missing");
  });
});
