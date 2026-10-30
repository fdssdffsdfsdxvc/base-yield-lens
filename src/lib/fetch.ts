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
 * Drop an RFC 4007 scoped IPv6 zone id ("%eth0", "%25eth0") from a host.
 * The zone only names the local interface; it does not change the scope of
 * the address, so a scoped "::1%lo" is still loopback and "ff02::1%eth0" is
 * still multicast. A zone id also makes the literal unparseable by the
 * WHATWG URL parser, which would otherwise hide the address entirely.
 */
function stripIpv6ZoneId(host: string): string {
  const pct = host.indexOf("%");
  if (pct === -1) return host;
  return host.slice(0, pct);
}

/**
 * If hostname is IPv4-mapped IPv6 (::ffff:…), return the embedded IPv4 string.
 * Node URL.hostname often rewrites dotted form to two hextets ("[::ffff:7f00:1]").
 */
export function ipv4MappedAddress(hostname: string): string | null {
  const h = stripIpv6ZoneId(
    hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, ""),
  );
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

/** Expand an IPv6 literal (optional brackets / dotted IPv4 tail) to 8 hextets, else null. */
export function expandIpv6(hostname: string): number[] | null {
  let h = stripIpv6ZoneId(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
  if (!h.includes(":")) return null;
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (tail) {
    const o = tail[2]!.split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    h = `${tail[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

/**
 * IPv4 address embedded in an IPv6 literal that reaches that IPv4 host:
 * IPv4-mapped ::ffff:0:0/96, IPv4-translated ::ffff:0:0:0/96 (SIIT),
 * deprecated IPv4-compatible ::/96, NAT64 well-known prefix 64:ff9b::/96,
 * 6to4 2002::/16 (embedded tunnel/IPv4 gateway in hextets 1-2), and Teredo
 * 2001::/32 (embedded Teredo server in hextets 2-3; the client IPv4 sits behind
 * a NAT and is never a destination).
 */
export function embeddedIpv4Address(hostname: string): string | null {
  const mapped = ipv4MappedAddress(hostname);
  if (mapped) return mapped;
  const g = expandIpv6(hostname);
  if (!g) return null;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (zero(0, 5) && g[5] === 0xffff) return v4; // uncompressed ::ffff:a.b.c.d
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4; // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4; // 64:ff9b::a.b.c.d
  // 6to4 2002:VVVV:WWWW::/48: the IPv4 gateway is in hextets 1-2. A private
  // embedded address (e.g. 2002:7f00:1::) is an SSRF bypass past v4 checks.
  if (g[0] === 0x2002) {
    return `${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`;
  }
  // Teredo 2001:0000:SSSS:CCCC::/48 (RFC 4380): hextets 2-3 hold the Teredo
  // server's IPv4 (often a private address on the client's LAN), so decode it
  // for the same SSRF check as the 6to4 gateway above.
  if (g[0] === 0x2001 && g[1] === 0) {
    return `${g[2]! >> 8}.${g[2]! & 255}.${g[3]! >> 8}.${g[3]! & 255}`;
  }
  // ::a.b.c.d (but not :: / ::1, handled as unspecified/loopback).
  if (zero(0, 6) && (g[6] !== 0 || g[7]! > 1)) return v4;
  return null;
}

/**
 * Canonicalize via the WHATWG URL host parser, as `new URL()` would: IPv4
 * shorthand / hex / octal / integer forms ("127.1", "0x7f.0.0.1", "2130706433")
 * become dotted quads, and IPv6 literals are compressed ("0:0:0:0:0:0:0:1" →
 * "[::1]"). An optional authority port ("host:443", "[v6]:443") is dropped first
 * (a Host header / `URL.host` value would otherwise pass as a DNS name), and an
 * RFC 4007 zone id ("[::1%25eth0]") is stripped, since it only names the local
 * interface and would otherwise make the literal unparseable.
 * Unparseable input falls back to the lowercased original.
 */
function canonicalHostname(hostname: string): string {
  const raw = hostname.trim().toLowerCase().replace(/\.(?=%)/g, "").replace(/\.+$/, "");
  const bracketedRaw = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(raw);
  const working = bracketedRaw ? raw : stripIpv6ZoneId(raw);
  const bracketed = bracketedRaw ?? /^\[([^\]]+)\](?::\d{1,5})?$/.exec(working);
  const zoneFree = bracketed ? working : stripIpv6ZoneId(working);
  // Exactly one colon separates host from port here, so a bare IPv6 hextet
  // list ("2001:db8::1", "0:0:0:0:0:0:0:1") is never mistaken for a port.
  const host0 = bracketed
    ? bracketed[1]!
    : /^[^[\]:]+:\d{1,5}$/.test(zoneFree)
      ? zoneFree.slice(0, zoneFree.lastIndexOf(":"))
      : zoneFree;
  const bare = stripIpv6ZoneId(host0.replace(/^\[|\]$/g, ""));
  const host = bare.includes(":") ? `[${bare}]` : bare;
  try {
    return new URL(`http://${host}/`).hostname || raw;
  } catch {
    return raw;
  }
}

/** True for localhost / loopback / 0.0.0.0\/8 / RFC1918 / CGNAT / multicast (IPv4 224/4, IPv6 ff00::/8) / reserved 240/4 / IANA special-purpose (192.0.0/24, TEST-NETs, 198.18/15) / IPv6 documentation prefixes (2001:db8::/32, 3fff::/20) / IPv6 discard-only (100::/64) / IPv6 dummy (100:0:0:1::/64) / IPv6 benchmarking (2001:2::/48) / IPv6 AMT (2001:3::/32) / link-local (fe80::/10) / IPv6 site-local (fec0::/10) / IPv6 ULA (fc00::/7) / .local/.localhost/.internal/home.arpa (RFC 8375). Accepts a bare hostname or a `host:port` authority (port ignored) and an RFC 4007 scoped IPv6 literal (zone id ignored, scope unchanged). */
export function isNonPublicHostname(hostname: string): boolean {
  // Node may keep brackets on IPv6 hostnames ("[fd12::1]").
  const h = canonicalHostname(hostname).replace(/\.+$/, "").replace(/^\[|\]$/g, "");
  const mapped = embeddedIpv4Address(h);
  if (mapped) return isNonPublicHostname(mapped);
  // NAT64 local-use prefix 64:ff9b:1::/48 (RFC 8215) is site-local by definition.
  const v6 = expandIpv6(h);
  if (v6 && v6[0] === 0x64 && v6[1] === 0xff9b && v6[2] === 1) return true;
  // IPv6 multicast ff00::/8 (first hextet ffXX), the counterpart of IPv4 224/4.
  if (v6 && v6[0]! >> 8 === 0xff) return true;
  // IPv6 documentation prefixes: RFC 3849 2001:db8::/32 and RFC 9637 3fff::/20.
  // IANA special-purpose and not globally reachable — the IPv6 counterpart of
  // the TEST-NET blocks rejected below.
  if (v6 && v6[0] === 0x2001 && v6[1] === 0xdb8) return true;
  if (v6 && v6[0] === 0x3fff && v6[1]! >> 12 === 0) return true;
  // IPv6 ORCHID (RFC 7343) 2001:10::/28 and ORCHIDv2 (RFC 9313) 2001:20::/28:
  // IANA special-purpose, not globally routable.
  if (
    v6 &&
    v6[0] === 0x2001 &&
    ((v6[1]! & 0xfff0) === 0x0010 || (v6[1]! & 0xfff0) === 0x0020)
  )
    return true;
  // IPv6 Drone Remote ID Protocol Entity Tags (RFC 9374) 2001:30::/28:
  // IANA special-purpose, not globally routable.
  if (v6 && v6[0] === 0x2001 && (v6[1]! & 0xfff0) === 0x0030) return true;
  // IPv6 Segment Routing SIDs (RFC 9602) 5f00::/16: IANA special-purpose,
  // not globally reachable.
  if (v6 && v6[0] === 0x5f00) return true;
  // IPv6 discard-only 100::/64 (RFC 6666) and benchmarking 2001:2::/48
  // (RFC 5180): IANA special-purpose, not globally reachable.
  if (v6 && v6[0] === 0x100 && v6[1] === 0 && v6[2] === 0 && v6[3] === 0) return true;
  // IPv6 Dummy prefix 100:0:0:1::/64 (RFC 9780): IANA special-purpose,
  // not globally reachable.
  if (v6 && v6[0] === 0x100 && v6[1] === 0 && v6[2] === 0 && v6[3] === 1) return true;
  if (v6 && v6[0] === 0x2001 && v6[1] === 2 && v6[2] === 0) return true;
  // IPv6 Automatic Multicast Tunneling (RFC 7450) 2001:3::/32: IETF protocol
  // assignment inside 2001::/23, not globally reachable.
  if (v6 && v6[0] === 0x2001 && v6[1] === 3) return true;
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::" ||
    h === "::1"
  ) {
    return true;
  }
  if (h.endsWith(".local") || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  // RFC 8375 special-use domain for home networks; never publicly resolvable,
  // and commonly served by home routers/DHCP like .local is.
  if (h === "home.arpa" || h.endsWith(".home.arpa")) return true;
  // IPv6 unique-local (fc00::/7), deprecated site-local (fec0::/10, RFC 3879),
  // and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]*:/i.test(h) || /^fe[89a-f][0-9a-f]*:/i.test(h)) {
    return true;
  }
  // Range checks below apply to IPv4 literals only; a DNS name such as
  // "10.api.example.com" or "127.cdn.example" is not a private address.
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return false;
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
  // Deprecated 6to4 relay router anycast (RFC 7526) 192.88.99.0/24; IANA
  // special-purpose and not globally reachable.
  if (/^192\.88\.99\./.test(h)) return true;
  return false;
}

/**
 * Mask URL userinfo (`user:pass@`) so error messages never echo secrets to
 * stderr/logs. Works on unparseable input too (regex, not URL parsing), and on
 * scheme-less / protocol-relative forms (`//u:p@h`, `\u:p@h`) that a scheme
 * anchored pattern would miss.
 */
export function redactUrlCredentials(url: string): string {
  // WHATWG URL accepts "https:u:p@h" and backslashes for special schemes too.
  // Only "/" bounds the authority here: "?"/"#" are delimiters inside a password
  // (a parseable URL would end the authority at them), and "\" is a path
  // separator for special schemes, so a password containing one puts the whole
  // userinfo outside the parsed authority and makes the raw URL unparseable —
  // excluding either from the match would abort it and echo the secret instead.
  // A credential-free host with an "@" in its path/query/fragment is at worst
  // over-masked, which is safe for a message.
  const masked = url.replace(
    /^(\s*(?:[a-z][a-z0-9+.-]*:[\/\\]*|[\/\\]+))[^/]*@/i,
    "$1***@",
  );
  if (masked !== url) return masked;
  // A password containing "/" ("https://u:p/ass@h") both aborts the match above
  // (the authority ends at that "/") and makes the URL unparseable (the truncated
  // authority leaves a non-numeric "port"), leaking the echoed credential. When
  // the URL parses cleanly, any "@" after the first "/" is in the path/query,
  // not userinfo — so only unparseable input gets this second, broader pass;
  // the "user:pass" ":" requirement keeps a bare path "@" untouched.
  try {
    new URL(url);
  } catch {
    const broader = url.replace(
      /^(\s*(?:[a-z][a-z0-9+.-]*:[\/\\]*|[\/\\]+))[^/\s]*:[^@]*@/i,
      "$1***@",
    );
    if (broader !== url) return broader;
  }
  return url;
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
 * C0/DEL/C1 controls (ANSI escapes, CR/LF, BEL), Unicode line/paragraph
 * separators, and bidi overrides. Labels come from an untrusted API and are
 * printed to a terminal: an ESC sequence could recolor/clear the screen, and
 * CR/LF/U+2028/U+2029 could forge extra summary lines.
 */
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

/** Cap on rendered label length: a huge upstream string must not flood stdout/logs. */
export const MAX_LABEL_LENGTH = 128;

/**
 * Cap on rows kept per section: even inside the MAX_RESPONSE_BYTES body cap, a
 * hostile endpoint can pack thousands of tiny records; without a row cap the
 * summary would emit tens of thousands of stdout/log lines.
 */
export const MAX_SUMMARY_ROWS = 1_000;

/** Non-empty string label (controls → space, trimmed, hard-capped length), else "?" (avoids "undefined"/"null" in CLI output). */
export function fmtLabel(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.replace(UNSAFE_LABEL_CHARS, " ").trim();
    if (!trimmed) return "?";
    if (trimmed.length <= MAX_LABEL_LENGTH) return trimmed;
    // Never end the capped label on a lone high surrogate: the 127-unit cut can
    // split an astral char (emoji) in two, and the orphan half renders as
    // mojibake / U+FFFD once the output is encoded as UTF-8.
    const head = trimmed.slice(0, MAX_LABEL_LENGTH - 1);
    const capped = /[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head;
    return `${capped}…`;
  }
  return "?";
}

/** Plain decimal (optional sign / fraction / exponent); excludes 0x/0o/0b radix forms. */
const DECIMAL_STRING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Coerce metrics for display. Numbers pass through (NaN/±Infinity → "?" via fmtNum).
 * Non-empty decimal strings are accepted; hex/octal/binary strings (Number("0x10")
 * === 16, e.g. raw on-chain quantities), booleans/arrays/objects/blank → NaN.
 */
function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && DECIMAL_STRING.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function capUntrustedText(value: string): string {
  const neutralized = value.replace(UNSAFE_LABEL_CHARS, " ").trim();
  if (neutralized.length <= MAX_LABEL_LENGTH) return neutralized;
  // Keep the surrogate-safe truncation used by fmtLabel so a capped timestamp
  // never ends on a lone high surrogate.
  const head = neutralized.slice(0, MAX_LABEL_LENGTH - 1);
  const capped = /[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head;
  return `${capped}…`;
}

function asOfString(value: unknown): string {
  // asOf is an untrusted API string printed into the summary: neutralize the
  // same control characters as labels (and cap its length) so it cannot forge
  // extra output lines or flood stdout/logs.
  return typeof value === "string" ? capUntrustedText(value) : "";
}

/** Drop nulls / non-objects / arrays; coerce fields so formatSummary never crashes; cap rows at MAX_SUMMARY_ROWS. */
export function normalizePools(value: unknown): PoolSnapshot[] {
  return asArray(value)
    .slice(0, MAX_SUMMARY_ROWS)
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
    .slice(0, MAX_SUMMARY_ROWS)
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

/**
 * Cap on how much of an untrusted response body is read into memory: a hostile
 * or misbehaving endpoint must not flood the heap with gigabytes before parse.
 * The `content-length` header is checked before reading when present, and the
 * body is otherwise streamed with the read cancelled as soon as the byte count
 * exceeds the cap (chunked / unknown-length responses) instead of buffering the
 * whole body first.
 */
export const MAX_RESPONSE_BYTES = 2_000_000;

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  // AbortSignal.timeout throws RangeError for negative, non-finite, or
  // fractional delays; fall back to the default so a bad caller-supplied
  // timeout keeps the offline-friendly failure path (summarizeYields catches
  // per-request rejections, but a synchronous throw would crash the CLI).
  const ms =
    Number.isFinite(timeoutMs) && Number.isInteger(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;
  const res = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(ms),
    // Following redirects would bypass assertPublicHttpsBaseUrl (a public https
    // root could 30x to http:// or a private/metadata host). Treat as failure.
    redirect: "error",
  });
  if (!res.ok) {
    // Mask embedded userinfo so a caller-supplied URL cannot leak secrets in
    // the error (summarizeYields validates its base, but fetchJson is public).
    throw new Error(`HTTP ${res.status} for ${redactUrlCredentials(url)}`);
  }
  const tooLarge = `HTTP body exceeds ${MAX_RESPONSE_BYTES} bytes for ${redactUrlCredentials(url)}`;
  const declared = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(tooLarge);
  }
  // Stream the body so a chunked / unknown-length response cannot fill the heap
  // before the size check: cancel the download as soon as it exceeds the cap.
  const reader = res.body?.getReader();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(tooLarge);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(tooLarge);
  }
  return JSON.parse(text) as T;
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
  const fetchedAt = capUntrustedText(s.fetchedAt);
  const lines = [
    `Base yield lens @ ${fetchedAt}`,
    `Pools: ${s.pools.length}`,
    ...s.pools.map((p) => {
      const asOf = capUntrustedText(p.asOf);
      const suffix = asOf ? ` @ ${asOf}` : "";
      return `  - [${fmtLabel(p.protocol)}] ${fmtLabel(p.symbol)} TVL=$${fmtNum(p.tvlUsd, 0)} APR=${fmtNum(p.aprPct, 2)}%${suffix}`;
    }),
    `Lending: ${s.lending.length}`,
    ...s.lending.map((m) => {
      const asOf = capUntrustedText(m.asOf);
      const suffix = asOf ? ` @ ${asOf}` : "";
      return `  - [${fmtLabel(m.protocol)}] ${fmtLabel(m.market)} supply=${fmtNum(m.supplyApyPct, 2)}% borrow=${fmtNum(m.borrowApyPct, 2)}%${suffix}`;
    }),
  ];
  return lines.join("\n");
}
