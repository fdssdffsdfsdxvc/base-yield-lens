import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpsBaseUrl,
  fetchJson,
  formatSummary,
  isNonPublicHostname,
  resolveBaseUrl,
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
    expect(text).toContain("TVL=$1000000");
    expect(text).toContain("APR=12.50%");
    expect(text).toContain("supply=3.10%");
    expect(text).toContain("borrow=4.20%");
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

  it("keeps lending data when only /pools fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response("unavailable", { status: 502 });
      }
      if (url.endsWith("/lending")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "aave-v3",
              market: "WETH",
              supplyApyPct: 1.25,
              borrowApyPct: 2.5,
              asOf: "2026-09-26T00:00:00.000Z",
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

    expect(summary.pools).toEqual([]);
    expect(summary.lending).toHaveLength(1);
    expect(summary.lending[0]?.market).toBe("WETH");
    expect(formatSummary(summary)).toMatch(/Pools: 0[\s\S]*Lending: 1/);
  });

  it("keeps pools data when only /lending fails", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "aerodrome",
              poolId: "0xdef",
              symbol: "cbETH/WETH",
              tvlUsd: 250_000,
              aprPct: 8.25,
              asOf: "2026-09-27T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/lending")) {
        return new Response("unavailable", { status: 502 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.pools).toHaveLength(1);
    expect(summary.pools[0]?.symbol).toBe("cbETH/WETH");
    expect(summary.lending).toEqual([]);
    expect(formatSummary(summary)).toMatch(/Pools: 1[\s\S]*Lending: 0/);
  });

  it("treats non-array JSON bodies as empty (no formatSummary crash)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(JSON.stringify({ error: "wrong shape" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/lending")) {
        return new Response(JSON.stringify("not-an-array"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.pools).toEqual([]);
    expect(summary.lending).toEqual([]);
    expect(() => formatSummary(summary)).not.toThrow();
  });

  it("returns empty arrays when JSON body is malformed", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
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

  it("returns parsed JSON for OK responses", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, n: 42 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchJson<{ ok: boolean; n: number }>(
        "https://mock.test/ok",
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true, n: 42 });
  });
});

describe("formatSummary", () => {
  it("renders empty snapshot counts without pool/lending lines", () => {
    const text = formatSummary({
      chain: "base",
      pools: [],
      lending: [],
      fetchedAt: "2026-09-26T07:00:00.000Z",
    });

    expect(text).toBe(
      [
        "Base yield lens @ 2026-09-26T07:00:00.000Z",
        "Pools: 0",
        "Lending: 0",
      ].join("\n"),
    );
  });

  it("renders ? for non-finite numeric fields instead of NaN", () => {
    const text = formatSummary({
      chain: "base",
      pools: [
        {
          protocol: "aerodrome",
          poolId: "0xbad",
          symbol: "BAD/USDC",
          tvlUsd: Number.NaN,
          aprPct: Number.POSITIVE_INFINITY,
          asOf: "2026-09-27T00:00:00.000Z",
        },
      ],
      lending: [
        {
          protocol: "aave-v3",
          market: "USDC",
          supplyApyPct: Number.NaN,
          borrowApyPct: -Number.NaN,
          asOf: "2026-09-27T00:00:00.000Z",
        },
      ],
      fetchedAt: "2026-09-27T08:00:00.000Z",
    });

    expect(text).toContain("TVL=$?");
    expect(text).toContain("APR=?%");
    expect(text).toContain("supply=?%");
    expect(text).toContain("borrow=?%");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
  });
});

describe("resolveBaseUrl", () => {
  it("uses DEFAULT when unset, blank, or whitespace", () => {
    const fallback = "https://api.example.invalid/base-defi";
    expect(resolveBaseUrl()).toBe(fallback);
    expect(resolveBaseUrl(undefined)).toBe(fallback);
    expect(resolveBaseUrl("")).toBe(fallback);
    expect(resolveBaseUrl("   ")).toBe(fallback);
    expect(resolveBaseUrl("\t\n")).toBe(fallback);
  });

  it("trims and strips trailing slashes", () => {
    expect(resolveBaseUrl(" https://mock.test/base-defi/ ")).toBe(
      "https://mock.test/base-defi",
    );
    expect(resolveBaseUrl("https://mock.test/base-defi///")).toBe(
      "https://mock.test/base-defi",
    );
  });

  it("rejects non-https, credentialed, hostless, or invalid base URLs", () => {
    expect(() => resolveBaseUrl("http://mock.test/base-defi")).toThrow(
      /must be https/,
    );
    expect(() => resolveBaseUrl("ftp://mock.test/base-defi")).toThrow(
      /must be https/,
    );
    expect(() => resolveBaseUrl("not-a-url")).toThrow(/valid https URL/);
    expect(() => resolveBaseUrl("https://")).toThrow(
      /valid https URL|must include a host/,
    );
    expect(() =>
      resolveBaseUrl("https://user:secret@mock.test/base-defi"),
    ).toThrow(/must not embed credentials/);
    expect(() => resolveBaseUrl("https://127.0.0.1/base-defi")).toThrow(
      /must not target a private host/,
    );
    expect(() => resolveBaseUrl("https://localhost/base-defi")).toThrow(
      /must not target a private host/,
    );
  });

  it("routes blank baseUrl through summarizeYields without building relative URLs", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await summarizeYields({ baseUrl: "  ", fetchImpl });

    expect(urls).toEqual([
      "https://api.example.invalid/base-defi/pools",
      "https://api.example.invalid/base-defi/lending",
    ]);
  });
});

describe("assertPublicHttpsBaseUrl", () => {
  it("accepts public https roots", () => {
    expect(() =>
      assertPublicHttpsBaseUrl("https://mock.test/base-defi"),
    ).not.toThrow();
  });

  it("rejects http and embedded credentials", () => {
    expect(() => assertPublicHttpsBaseUrl("http://mock.test/x")).toThrow(
      /must be https/,
    );
    expect(() =>
      assertPublicHttpsBaseUrl("https://u:p@mock.test/x"),
    ).toThrow(/must not embed credentials/);
  });

  it("rejects localhost and private-network hosts", () => {
    expect(() =>
      assertPublicHttpsBaseUrl("https://localhost/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://127.0.0.1/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://10.0.0.5/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://192.168.1.1/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://172.16.0.2/base-defi"),
    ).toThrow(/must not target a private host/);
  });
});

describe("isNonPublicHostname", () => {
  it("flags loopback, RFC1918, link-local, .local, and IPv6 ULA", () => {
    expect(isNonPublicHostname("localhost")).toBe(true);
    expect(isNonPublicHostname("127.0.0.1")).toBe(true);
    expect(isNonPublicHostname("10.1.2.3")).toBe(true);
    expect(isNonPublicHostname("172.31.255.255")).toBe(true);
    expect(isNonPublicHostname("192.168.0.1")).toBe(true);
    expect(isNonPublicHostname("169.254.1.1")).toBe(true);
    expect(isNonPublicHostname("printer.local")).toBe(true);
    expect(isNonPublicHostname("fd12::1")).toBe(true);
    expect(isNonPublicHostname("fe80::1")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isNonPublicHostname("api.example.invalid")).toBe(false);
    expect(isNonPublicHostname("mock.test")).toBe(false);
    expect(isNonPublicHostname("172.32.0.1")).toBe(false);
  });
});

describe("normalizePools / normalizeLending", () => {
  it("drops null/non-object elements so formatSummary does not crash", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            null,
            "nope",
            {
              protocol: "aerodrome",
              poolId: "0xok",
              symbol: "WETH/USDC",
              tvlUsd: 10,
              aprPct: 1,
              asOf: "2026-09-29T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/lending")) {
        return new Response(JSON.stringify([undefined, 42, null]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl,
    });

    expect(summary.pools).toHaveLength(1);
    expect(summary.pools[0]?.symbol).toBe("WETH/USDC");
    expect(summary.lending).toEqual([]);
    expect(() => formatSummary(summary)).not.toThrow();
    expect(formatSummary(summary)).toContain("WETH/USDC");
    expect(formatSummary(summary)).not.toContain("undefined");
    expect(formatSummary(summary)).not.toContain("null");
  });

  it("coerces missing/blank/non-string labels to ? and non-number metrics to NaN→?", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "  ",
              poolId: null,
              symbol: 123,
              tvlUsd: "not-a-number",
              aprPct: null,
              asOf: null,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/lending")) {
        return new Response(
          JSON.stringify([
            {
              protocol: null,
              market: "",
              supplyApyPct: "1",
              borrowApyPct: {},
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

    expect(summary.pools[0]).toMatchObject({
      protocol: "?",
      poolId: "?",
      symbol: "?",
    });
    expect(Number.isNaN(summary.pools[0]!.tvlUsd)).toBe(true);
    expect(summary.lending[0]).toMatchObject({
      protocol: "?",
      market: "?",
    });
    const text = formatSummary(summary);
    expect(text).toContain("[?] ? TVL=$? APR=?%");
    expect(text).toContain("[?] ? supply=?% borrow=?%");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});
