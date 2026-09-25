import { describe, expect, it, vi } from "vitest";
import { formatSummary, summarizeYields } from "../src/lib/fetch.js";

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
});
