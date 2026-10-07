import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  assertPublicHttpsBaseUrl,
  embeddedIpv4Address,
  fetchJson,
  fmtLabel,
  formatSummary,
  ipv4MappedAddress,
  isNonPublicHostname,
  redactUrlCredentials,
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
    expect(() =>
      assertPublicHttpsBaseUrl("https://[fd12::1]/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://api.localhost/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://100.64.1.2/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://[::ffff:127.0.0.1]/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://0.0.0.42/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://[::]/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://224.0.0.251/base-defi"),
    ).toThrow(/must not target a private host/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://metadata.google.internal/base-defi"),
    ).toThrow(/must not target a private host/);
  });

  it("rejects query or hash on the API root (breaks /pools path join)", () => {
    expect(() =>
      assertPublicHttpsBaseUrl("https://mock.test/base-defi?x=1"),
    ).toThrow(/must not include query or hash/);
    expect(() =>
      assertPublicHttpsBaseUrl("https://mock.test/base-defi#frag"),
    ).toThrow(/must not include query or hash/);
    expect(() =>
      resolveBaseUrl("https://mock.test/base-defi?token=secret"),
    ).toThrow(/must not include query or hash/);
  });

  it("rejects a bare trailing ? or # (empty query/hash still breaks path join)", () => {
    // new URL(...).search/hash are "" here, but `${base}/pools` would become
    // "https://mock.test/base-defi?/pools" (query) or "#/pools" (dropped fragment).
    for (const u of [
      "https://mock.test/base-defi?",
      "https://mock.test/base-defi#",
      "https://mock.test/base-defi?#",
      "https://mock.test/?",
    ]) {
      expect(() => assertPublicHttpsBaseUrl(u)).toThrow(/must not include query or hash/);
      expect(() => resolveBaseUrl(u)).toThrow(/must not include query or hash/);
    }
  });
});

describe("isNonPublicHostname", () => {
  it("flags loopback, RFC1918, link-local, .local, and IPv6 ULA", () => {
    expect(isNonPublicHostname("localhost")).toBe(true);
    expect(isNonPublicHostname("127.0.0.1")).toBe(true);
    expect(isNonPublicHostname("0.0.0.1")).toBe(true);
    expect(isNonPublicHostname("0.255.255.255")).toBe(true);
    expect(isNonPublicHostname("10.1.2.3")).toBe(true);
    expect(isNonPublicHostname("172.31.255.255")).toBe(true);
    expect(isNonPublicHostname("192.168.0.1")).toBe(true);
    expect(isNonPublicHostname("169.254.1.1")).toBe(true);
    expect(isNonPublicHostname("100.64.0.1")).toBe(true);
    expect(isNonPublicHostname("100.127.255.254")).toBe(true);
    expect(isNonPublicHostname("printer.local")).toBe(true);
    expect(isNonPublicHostname("api.localhost")).toBe(true);
    expect(isNonPublicHostname("metadata.google.internal")).toBe(true);
    expect(isNonPublicHostname("fd12::1")).toBe(true);
    expect(isNonPublicHostname("fe80::1")).toBe(true);
    // Node URL.hostname keeps brackets for IPv6 literals.
    expect(isNonPublicHostname("[fd12::1]")).toBe(true);
    expect(isNonPublicHostname("[fe80::1]")).toBe(true);
    expect(isNonPublicHostname("[::1]")).toBe(true);
    expect(isNonPublicHostname("::")).toBe(true);
    expect(isNonPublicHostname("[::]")).toBe(true);
    expect(isNonPublicHostname("224.0.0.1")).toBe(true);
    expect(isNonPublicHostname("239.255.255.255")).toBe(true);
    expect(isNonPublicHostname("255.255.255.255")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isNonPublicHostname("api.example.invalid")).toBe(false);
    expect(isNonPublicHostname("mock.test")).toBe(false);
    expect(isNonPublicHostname("172.32.0.1")).toBe(false);
    expect(isNonPublicHostname("100.63.255.255")).toBe(false);
    expect(isNonPublicHostname("100.128.0.1")).toBe(false);
    expect(isNonPublicHostname("223.255.255.255")).toBe(false);
    // Neighbours of the IANA special-purpose blocks stay public.
    expect(isNonPublicHostname("192.0.1.1")).toBe(false);
    expect(isNonPublicHostname("192.0.3.1")).toBe(false);
    expect(isNonPublicHostname("198.17.255.255")).toBe(false);
    expect(isNonPublicHostname("198.20.0.1")).toBe(false);
    expect(isNonPublicHostname("198.51.101.1")).toBe(false);
    expect(isNonPublicHostname("203.0.114.1")).toBe(false);
    expect(isNonPublicHostname("2.4.0.1")).toBe(false);
    expect(isNonPublicHostname("25.0.0.1")).toBe(false);
  });

  it("does not mistake DNS names with numeric leading labels for private IPv4", () => {
    for (const host of [
      "10.api.example.com",
      "127.cdn.example",
      "192.168.example.org",
      "172.16.example.net",
      "240.example.net",
      "100.64.example",
    ]) {
      expect(isNonPublicHostname(host), host).toBe(false);
      expect(() => assertPublicHttpsBaseUrl(`https://${host}/base-defi`)).not.toThrow();
    }
    // Real IPv4 literals (incl. trailing dot) are still flagged.
    expect(isNonPublicHostname("10.0.0.1.")).toBe(true);
    expect(isNonPublicHostname("127.0.0.1")).toBe(true);
  });

  it("flags reserved 240/4 and IANA special-purpose non-global IPv4 blocks", () => {
    for (const ip of [
      "240.0.0.1",
      "250.1.2.3",
      "255.255.255.254",
      "192.0.0.8",
      "192.0.2.10",
      "198.18.0.1",
      "198.19.255.255",
      "198.51.100.7",
      "203.0.113.9",
    ]) {
      expect(isNonPublicHostname(ip), ip).toBe(true);
    }
    expect(() => assertPublicHttpsBaseUrl("https://198.18.0.1/base-defi")).toThrow(
      /must not target a private host/,
    );
    expect(isNonPublicHostname("[::ffff:c612:1]")).toBe(true); // ::ffff:198.18.0.1
  });

  it("flags private IPv4-mapped IPv6 (::ffff:) hosts", () => {
    expect(ipv4MappedAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(ipv4MappedAddress("[::ffff:7f00:1]")).toBe("127.0.0.1");
    expect(ipv4MappedAddress("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(ipv4MappedAddress("[::ffff:a00:1]")).toBe("10.0.0.1");
    expect(isNonPublicHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isNonPublicHostname("[::ffff:7f00:1]")).toBe(true);
    expect(isNonPublicHostname("::ffff:10.1.2.3")).toBe(true);
    expect(isNonPublicHostname("[::ffff:c0a8:101]")).toBe(true); // 192.168.1.1
    expect(isNonPublicHostname("::ffff:8.8.8.8")).toBe(false);
    expect(isNonPublicHostname("[::ffff:808:808]")).toBe(false); // 8.8.8.8
  });

  it("flags private IPv4 embedded via NAT64, IPv4-compatible, or IPv4-translated IPv6", () => {
    // Node URL.hostname normalizes "::127.0.0.1" → "[::7f00:1]", etc.
    expect(new URL("https://[::127.0.0.1]/").hostname).toBe("[::7f00:1]");
    expect(embeddedIpv4Address("[::7f00:1]")).toBe("127.0.0.1");
    expect(embeddedIpv4Address("[64:ff9b::a9fe:a9fe]")).toBe("169.254.169.254");
    expect(embeddedIpv4Address("64:ff9b::10.0.0.1")).toBe("10.0.0.1");
    expect(embeddedIpv4Address("[::ffff:0:a9fe:a9fe]")).toBe("169.254.169.254");
    expect(embeddedIpv4Address("[0:0:0:0:0:ffff:7f00:1]")).toBe("127.0.0.1");
    expect(embeddedIpv4Address("[2606:4700::1111]")).toBeNull();
    expect(embeddedIpv4Address("[::1]")).toBeNull();
    expect(embeddedIpv4Address("example.com")).toBeNull();
    for (const host of [
      "[::7f00:1]",
      "[64:ff9b::a9fe:a9fe]",
      "[64:ff9b::a00:1]",
      "[::ffff:0:a9fe:a9fe]",
      "[64:ff9b:1::a00:1]",
      "[64:ff9b:1::808:808]",
    ]) {
      expect(isNonPublicHostname(host), host).toBe(true);
      expect(() => assertPublicHttpsBaseUrl(`https://${host}/base-defi`)).toThrow(
        /must not target a private host/,
      );
    }
    // Public IPv4 behind NAT64 / ordinary global IPv6 stay allowed.
    expect(isNonPublicHostname("[64:ff9b::808:808]")).toBe(false);
    expect(isNonPublicHostname("[2606:4700::1111]")).toBe(false);
  });

  it("flags IPv6 multicast ff00::/8 hosts like IPv4 multicast", () => {
    for (const host of ["ff02::1", "[ff05::1:3]", "FF0E::101", "[ff02:0:0:0:0:0:0:1]"]) {
      expect(isNonPublicHostname(host), host).toBe(true);
    }
    expect(() => assertPublicHttpsBaseUrl("https://[ff02::1]/base-defi")).toThrow(
      /must not target a private host/,
    );
    // 00ff::/16 is not multicast (first hextet must be ffXX).
    expect(isNonPublicHostname("[ff::1]")).toBe(false);
  });
});

describe("fmtLabel", () => {
  it("trims surrounding whitespace on non-blank labels", () => {
    expect(fmtLabel("  aerodrome  ")).toBe("aerodrome");
    expect(fmtLabel("\tWETH/USDC\n")).toBe("WETH/USDC");
    expect(fmtLabel("ok")).toBe("ok");
    expect(fmtLabel("   ")).toBe("?");
    expect(fmtLabel("")).toBe("?");
    expect(fmtLabel(null)).toBe("?");
    expect(fmtLabel(12)).toBe("?");
  });

  it("neutralizes terminal control characters from untrusted API labels", () => {
    expect(fmtLabel("\u001b[31mevil\u001b[0m")).toBe("[31mevil [0m");
    expect(fmtLabel("aero\r\nPools: 999")).toBe("aero Pools: 999");
    expect(fmtLabel("A\u0007B\u007fC\u009bD")).toBe("A B C D");
    expect(fmtLabel("USDC\u202egnp.exe")).toBe("USDC gnp.exe");
    expect(fmtLabel("\u001b\u0007")).toBe("?");
    expect(fmtLabel("WETH/USDC")).toBe("WETH/USDC");
    const text = formatSummary({
      chain: "base",
      pools: [
        {
          protocol: "x\u001b[2J",
          poolId: "1",
          symbol: "A\nPools: 999",
          tvlUsd: 1,
          aprPct: 1,
          asOf: "t",
        },
      ],
      lending: [],
      fetchedAt: "t",
    });
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(text.split("\n")).toHaveLength(4);
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

  it("drops nested array elements so they do not become junk ? rows", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            ["nested", "array"],
            {
              protocol: "aerodrome",
              poolId: "0xok",
              symbol: "WETH/USDC",
              tvlUsd: 10,
              aprPct: 1,
              asOf: "2026-10-04T00:00:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/lending")) {
        return new Response(
          JSON.stringify([
            [{ market: "nested" }],
            {
              protocol: "aave-v3",
              market: "USDC",
              supplyApyPct: 3,
              borrowApyPct: 4,
              asOf: "2026-10-04T00:00:00.000Z",
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

    expect(summary.pools).toHaveLength(1);
    expect(summary.pools[0]?.symbol).toBe("WETH/USDC");
    expect(summary.lending).toHaveLength(1);
    expect(summary.lending[0]?.market).toBe("USDC");
    const text = formatSummary(summary);
    expect(text).toContain("Pools: 1");
    expect(text).toContain("Lending: 1");
    expect(text).not.toMatch(/Pools: 2/);
  });

  it("accepts finite numeric strings for pool/lending metrics", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pools")) {
        return new Response(
          JSON.stringify([
            {
              protocol: "aerodrome",
              poolId: "0x1",
              symbol: "WETH/USDC",
              tvlUsd: "1000000",
              aprPct: "12.5",
              asOf: "2026-10-04T00:00:00.000Z",
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
              supplyApyPct: "3.1",
              borrowApyPct: " 4.2 ",
              asOf: "2026-10-04T00:00:00.000Z",
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

    expect(summary.pools[0]?.tvlUsd).toBe(1_000_000);
    expect(summary.pools[0]?.aprPct).toBe(12.5);
    expect(summary.lending[0]?.supplyApyPct).toBe(3.1);
    expect(summary.lending[0]?.borrowApyPct).toBe(4.2);
    const text = formatSummary(summary);
    expect(text).toContain("TVL=$1000000");
    expect(text).toContain("APR=12.50%");
    expect(text).toContain("supply=3.10%");
    expect(text).toContain("borrow=4.20%");
    // Booleans/arrays must not coerce via Number(true)===1 / Number([5])===5.
    const bad = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.endsWith("/pools")
          ? [{ protocol: "x", poolId: "1", symbol: "Y", tvlUsd: true, aprPct: [5], asOf: "t" }]
          : [{ protocol: "x", market: "Y", supplyApyPct: false, borrowApyPct: {}, asOf: "t" }];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(Number.isNaN(bad.pools[0]!.tvlUsd)).toBe(true);
    expect(Number.isNaN(bad.pools[0]!.aprPct)).toBe(true);
    expect(Number.isNaN(bad.lending[0]!.supplyApyPct)).toBe(true);
    expect(formatSummary(bad)).toContain("TVL=$?");
  });

  it("rejects hex/octal/binary metric strings instead of reading them as decimal", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.endsWith("/pools")
        ? [
            { protocol: "x", poolId: "1", symbol: "A", tvlUsd: "0x1bc16d674ec80000", aprPct: "0b101", asOf: "t" },
            { protocol: "x", poolId: "2", symbol: "B", tvlUsd: "1e6", aprPct: "-.5", asOf: "t" },
          ]
        : [{ protocol: "x", market: "Y", supplyApyPct: "0o17", borrowApyPct: "+4.", asOf: "t" }];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const s = await summarizeYields({ baseUrl: "https://mock.test/base-defi", fetchImpl });
    expect(Number.isNaN(s.pools[0]!.tvlUsd)).toBe(true);
    expect(Number.isNaN(s.pools[0]!.aprPct)).toBe(true);
    expect(Number.isNaN(s.lending[0]!.supplyApyPct)).toBe(true);
    expect(s.pools[1]!.tvlUsd).toBe(1_000_000);
    expect(s.pools[1]!.aprPct).toBe(-0.5);
    expect(s.lending[0]!.borrowApyPct).toBe(4);
    expect(formatSummary(s)).toContain("[x] A TVL=$? APR=?%");
  });

  it("coerces missing/blank/non-string labels to ?; non-numeric metrics to NaN→?", async () => {
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
      supplyApyPct: 1,
    });
    expect(Number.isNaN(summary.lending[0]!.borrowApyPct)).toBe(true);
    const text = formatSummary(summary);
    expect(text).toContain("[?] ? TVL=$? APR=?%");
    expect(text).toContain("[?] ? supply=1.00% borrow=?%");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });
});

describe("redactUrlCredentials", () => {
  it("masks userinfo and leaves credential-free URLs untouched", () => {
    expect(redactUrlCredentials("https://user:hunter2@mock.test/x")).toBe(
      "https://***@mock.test/x",
    );
    expect(redactUrlCredentials("https:u:p@mock.test/x")).toBe(
      "https:***@mock.test/x",
    );
    expect(redactUrlCredentials("https://a@b:c@mock.test/x")).toBe(
      "https://***@mock.test/x",
    );
    expect(redactUrlCredentials("https://mock.test/a@b")).toBe(
      "https://mock.test/a@b",
    );
    expect(redactUrlCredentials("not-a-url")).toBe("not-a-url");
  });

  it("never echoes embedded passwords in YIELD_LENS_BASE_URL errors", () => {
    const cases = [
      "https://user:hunter2@mock.test/base-defi",
      "http://user:hunter2@mock.test/base-defi",
      "https://user:hunter2@127.0.0.1/base-defi",
    ];
    for (const url of cases) {
      let message = "";
      try {
        resolveBaseUrl(url);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/^YIELD_LENS_BASE_URL must/);
      expect(message).not.toContain("hunter2");
      expect(message).toContain("***@");
    }
  });
});

describe("fetch timeout", () => {
  /** Never resolves on its own; rejects only when the request signal aborts. */
  const hangingFetch = (seen: (AbortSignal | null | undefined)[]) =>
    vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seen.push(init?.signal);
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;

  it("fetchJson passes an abort signal and rejects when the deadline passes", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    await expect(
      fetchJson("https://mock.test/slow", hangingFetch(seen), 20),
    ).rejects.toThrow();
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("summarizeYields falls back to empty arrays instead of hanging", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const summary = await summarizeYields({
      baseUrl: "https://mock.test/base-defi",
      fetchImpl: hangingFetch(seen),
      timeoutMs: 20,
    });
    expect(summary.pools).toEqual([]);
    expect(summary.lending).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it("defaults to a finite per-request timeout", () => {
    expect(Number.isFinite(DEFAULT_FETCH_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("fetch redirects", () => {
  it("fetchJson asks fetch not to follow redirects", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    await fetchJson("https://mock.test/pools", fetchImpl);
    expect(init?.redirect).toBe("error");
  });

  it("real fetch rejects a 302 instead of following it to another target", async () => {
    let followed = false;
    const server = createServer((req, res) => {
      if (req.url === "/target") {
        followed = true;
        res.setHeader("content-type", "application/json");
        res.end('[{"protocol":"leak"}]');
        return;
      }
      res.statusCode = 302;
      res.setHeader("location", "/target");
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(
        fetchJson(`http://127.0.0.1:${port}/pools`),
      ).rejects.toThrow();
      expect(followed).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
