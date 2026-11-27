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
  // RFC 4007 zone ids only follow an IPv6 literal (which contains ":" or is
  // bracketed). A "%" elsewhere is percent-encoding (e.g. "%31" for "1") and
  // must be preserved so the URL parser can decode it instead of being
  // truncated into an empty/different host.
  const before = host.slice(0, pct);
  if (!before.includes(":") && !before.includes("]")) return host;
  // A trailing dot may sit between the address and the zone separator
  // ("::1.%eth0"); drop it along with the zone id.
  return before.replace(/\.+$/, "");
}


/**
 * Drop an embedded userinfo ("user:pass@host") from a host string so
 * credentials cannot mask the host that is actually being classified. Only
 * an "@" that appears before any authority delimiter (/, \, ?, #) is treated
 * as userinfo: an "@" later in the path/query/fragment belongs to that part
 * and must not truncate a private host into a public-looking one.
 */
function stripEmbeddedUserInfo(host: string): string {
  const delimiters = ["/", "\\", "?", "#", "／", "＼", "？", "＃"];
  let firstDelim = host.length;
  for (const d of delimiters) {
    const i = host.indexOf(d);
    if (i !== -1 && i < firstDelim) firstDelim = i;
  }
  const authority = host.slice(0, firstDelim);
  const at = authority.lastIndexOf("@");
  if (at !== -1) return authority.slice(at + 1);
  return authority;
}
/**
 * If hostname is IPv4-mapped IPv6 (::ffff:…), return the embedded IPv4 string.
 * Node URL.hostname often rewrites dotted form to two hextets ("[::ffff:7f00:1]").
 */
export function ipv4MappedAddress(hostname: string): string | null {
  const hostInput = stripEmbeddedUserInfo(hostname);
  const h = stripIpv6ZoneId(
    hostInput.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, ""),
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
  const hostInput = stripEmbeddedUserInfo(hostname);
  let h = stripIpv6ZoneId(hostInput.toLowerCase().replace(/^\[|\]$/g, ""));
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
  // NFKC-fold compatibility equivalents of authority separators before any
  // parsing: the URL parser rejects a fullwidth colon ("127.0.0.1：8080") or
  // fullwidth "@" rather than treating it as a port / userinfo delimiter, so
  // without this a private host could be classified as public when this
  // exported helper is called directly with a `host:port` authority.
  const hostInput = stripEmbeddedUserInfo(hostname.normalize("NFKC"));
  const authorityInput = hostInput.split(/[\\/?#／＼？＃]/)[0] ?? hostInput;
  const raw = authorityInput.trim().toLowerCase().replace(/\.+$/, "");
  const bracketedRaw = /^\[([^\]]+)\](?:\.+)?(?::.*)?$/.exec(raw);
  const working = bracketedRaw ? raw : stripIpv6ZoneId(raw);
  const bracketed = bracketedRaw ?? /^\[([^\]]+)\](?:\.+)?(?::.*)?$/.exec(working);
  const zoneFree = bracketed ? working : stripIpv6ZoneId(working);
  // Exactly one colon separates host from port here, so a bare IPv6 hextet
  // list ("2001:db8::1", "0:0:0:0:0:0:0:1") is never mistaken for a port.
  // Any suffix after that single colon (or after a closing bracket) is treated
  // as a port and stripped, even when it is not a valid 1-5 digit port, so an
  // out-of-range/over-long/non-numeric port cannot mask the host behind it.
  // A trailing DNS-root dot may sit between an IPv6/IPv4 literal and its
  // authority port ("::1.:8080", "[::1].:8080"); strip it together with the
  // port so the address itself is what gets classified.
  const dottedPort = /^(.+)\.+(:[^:]*)$/.exec(zoneFree);
  const host0 = bracketed
    ? bracketed[1]!.replace(/\.+$/, "")
    : dottedPort
      ? dottedPort[1]!.replace(/\.+$/, "")
      : /^[^[\]:]+:[^:]*$/.test(zoneFree)
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

/** True for localhost / loopback / 0.0.0.0\/8 / RFC1918 / CGNAT / multicast (IPv4 224/4, IPv6 ff00::/8) / reserved 240/4 / IANA special-purpose (192.0.0/24, TEST-NETs, 198.18/15, 192.88.99/24, 192.52.193/24, AS112 192.31.196/24 + 192.175.48/24) / IPv6 documentation prefixes (2001:db8::/32, 3fff::/20) / IPv6 discard-only (100::/64) / IPv6 dummy (100:0:0:1::/64) / IPv6 benchmarking (2001:2::/48) / IPv6 PCP/TURN anycast (2001:1::/32) / IPv6 AMT (2001:3::/32) / IPv6 AS112-v6 (2001:4:112::/48) / IPv6 Direct Delegation AS112 (2620:4f:8000::/48) / link-local (fe80::/10) / IPv6 site-local (fec0::/10) / IPv6 ULA (fc00::/7) / .local/.localhost/.internal/home.arpa (RFC 8375). Accepts a bare hostname or a `host:port` authority (port ignored) and an RFC 4007 scoped IPv6 literal (zone id ignored, scope unchanged). */
export function isNonPublicHostname(hostname: string): boolean {
  // Node may keep brackets on IPv6 hostnames ("[fd12::1]").
  const h = canonicalHostname(hostname).replace(/\.+$/, "").replace(/^\[|\]$/g, "");
  const v6 = expandIpv6(h);
  // Forbidden WHATWG host code points (controls, space, angles, brackets,
  // backslash, caret, pipe) and percent make a raw hostname unparseable: URL
  // parsing then falls back to the raw string, so a suffix after the first such
  // character cannot turn a private host public — classify by the prefix before
  // it, too. Check the raw authority, not the canonical h: the URL parser
  // silently removes TAB/CR/LF (joining "127.0.0.1\nevil" into "127.0.0.1evil")
  // instead of failing. Skip this for a well-formed IPv6 literal: its colons
  // are structural, and canonicalizing just the first hextet as an IPv4
  // shorthand ("2606" → 0.0.10.46) would wrongly reject public addresses.
  const rawHost = stripEmbeddedUserInfo(hostname);
  if (h === "255.255.255.255") return true;
  if (!v6) {
    // Forbidden WHATWG host code points (controls, space, angles, brackets,
    // backslash, caret, pipe) plus quotes, backticks, braces, and other
    // punctuation that Node's URL parser keeps in the host (so a suffix after
    // one cannot turn a private prefix public): classify by the prefix before
    // the first such character. Colon is deliberately excluded so IPv6 literals
    // keep their structural colons; port-style colons are handled below.
    const forbiddenRegex = /[\u0000-\u0020<>"`\[\]\\^|%{}!$&'()*+,;=_~#?\/@|\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u00ad\u034f\u180b-\u180d\u180f\u200b\u2060\u2064\ufe00-\ufe0f\ufeff\u{1bca0}-\u{1bca3}\u{e0100}-\u{e01ef}\s\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
    // URL parsers normalize many fullwidth/homoglyph code points to the ASCII
    // forbidden host code points above (e.g. U+FF02 -> `"`, U+FF40 -> "`"),
    // so classify on the NFKC-normalized authority to catch those variants too.
    const normalizedRawHost = rawHost.normalize("NFKC");
    // A leading "[" opens a bracketed IPv6 literal and must not itself be
    // treated as a forbidden suffix boundary (otherwise "[::1]..." could never
    // be classified by its prefix).
    let forbiddenIdx = normalizedRawHost.search(forbiddenRegex);
    if (forbiddenIdx === 0 && normalizedRawHost.startsWith("[")) {
      const rest = normalizedRawHost.slice(1).search(forbiddenRegex);
      forbiddenIdx = rest === -1 ? -1 : rest + 1;
    }
    if (forbiddenIdx !== -1) {
      const prefix = normalizedRawHost.slice(0, forbiddenIdx).replace(/\.+$/, "");
      if (prefix && isNonPublicHostname(prefix)) return true;
    } else {
      // Not valid IPv6 but still colon-bearing (e.g. "10.0.0.1:8080:9999"):
      // treat the first colon as the host/port boundary and classify the host.
      const colonIdx = h.indexOf(":");
      if (colonIdx > 0) {
        const prefix = h.slice(0, colonIdx).replace(/\.+$/, "");
        if (prefix && isNonPublicHostname(prefix)) return true;
      }
    }
  }
  const mapped = embeddedIpv4Address(h);
  if (mapped) return isNonPublicHostname(mapped);
  // NAT64 local-use prefix 64:ff9b:1::/48 (RFC 8215) is site-local by definition.
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
  // IETF protocol assignments 2001:1::/32 (inside 2001::/23) hold the PCP
  // anycast 2001:1::1 (RFC 7723) and TURN anycast 2001:1::2 (RFC 8155); the
  // whole block is IANA special-purpose and not a reachable API endpoint.
  if (v6 && v6[0] === 0x2001 && v6[1] === 1) return true;
  // IPv6 Automatic Multicast Tunneling (RFC 7450) 2001:3::/32: IETF protocol
  // assignment inside 2001::/23, not globally reachable.
  if (v6 && v6[0] === 0x2001 && v6[1] === 3) return true;
  // IPv6 AS112-v6 anycast (RFC 7534) 2001:4:112::/48: IANA special-purpose,
  // not globally reachable — the IPv6 counterpart of the AS112 blocks above.
  if (v6 && v6[0] === 0x2001 && v6[1] === 4 && v6[2] === 0x112) return true;
  // Direct Delegation AS112 Service (RFC 7534) 2620:4f:8000::/48: the other
  // AS112 IPv6 anycast prefix, also IANA special-purpose and not a reachable
  // API endpoint. First three hextets fix the /48; neighbours stay public.
  if (v6 && v6[0] === 0x2620 && v6[1] === 0x004f && v6[2] === 0x8000) return true;
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
  // Deprecated 6to4 relay router anycast (RFC 7526) 192.88.99.0/24, AMT
  // relay anycast (RFC 7450) 192.52.193.0/24, and AS112 nameserver-redirection
  // anycast (RFC 7534/7535) 192.31.196.0/24 + 192.175.48.0/24; all IANA
  // special-purpose and not globally reachable.
  if (
    /^192\.88\.99\./.test(h) ||
    /^192\.52\.193\./.test(h) ||
    /^192\.31\.196\./.test(h) ||
    /^192\.175\.48\./.test(h)
  )
    return true;
  return false;
}

/**
 * Mask URL userinfo (`user:pass@`) so error messages never echo secrets to
 * stderr/logs. Works on unparseable input too (regex, not URL parsing), and on
 * scheme-less / protocol-relative forms (`//u:p@h`, `\u:p@h`) that a scheme
 * anchored pattern would miss.
 */
export function redactUrlCredentials(url: string): string {
  // NFKC-fold compatibility variants of authority separators first: the URL
  // parser rejects a fullwidth "@"/":" in userinfo ("https://user＠h" or
  // "https://user：pass@h"), so without folding, the raw secret would survive
  // every pass below and be echoed in the error message. ASCII input is unchanged.
  const normalized = url.normalize("NFKC");
  // WHATWG URL accepts "https:u:p@h" and backslashes for special schemes too.
  // Bound the authority at "/", "?" and "#": an "@" after any of them belongs to
  // the path/query/fragment, not userinfo, so masking through it would drop the
  // host from the message (e.g. "https://u:p@h#f@x" -> "https://***@x"). A
  // password containing "?"/"#" (or "\" — a path separator for special schemes)
  // puts the userinfo outside the parsed authority and makes the URL
  // unparseable, so it is still masked by the broader fallback pass below, which
  // does not bound at these delimiters; the secret is never echoed either way.
  const masked = normalized.replace(
    /^(\s*(?:[a-z][a-z0-9+.-]*:[\/\\]*|[\/\\]+))[^/?#]*@/i,
    "$1***@",
  );
  if (masked !== normalized) return masked;
  // A password containing "/" ("https://u:p/ass@h") both aborts the match above
  // (the authority ends at that "/") and makes the URL unparseable (the truncated
  // authority leaves a non-numeric "port"), leaking the echoed credential. When
  // the URL parses cleanly, any "@" after the first "/" is in the path/query,
  // not userinfo — so only unparseable input gets this second, broader pass;
  // the "user:pass" ":" requirement keeps a bare path "@" untouched.
  try {
    new URL(normalized);
  } catch {
    const broader = normalized.replace(
      /^(\s*(?:[a-z][a-z0-9+.-]*:[\/\\]*|[\/\\]+))[^/\s]*:[^@]*@/i,
      "$1***@",
    );
    if (broader !== normalized) return broader;
  }
  // Nothing was masked: echo the caller's original string, not the folded copy,
  // so unrelated compatibility characters are not rewritten in the message.
  return url;
}

/**
 * Public https API root: https only, non-empty host, no embedded credentials,
 * no localhost/private hosts, no query/hash (path join uses `${base}/pools`).
 * Used for YIELD_LENS_BASE_URL after blank-check + trailing-slash strip.
 */
export function assertPublicHttpsBaseUrl(url: string): void {
  const shown = redactUrlCredentials(url);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(url)) {
    throw new Error(`YIELD_LENS_BASE_URL must not include control characters: ${shown}`);
  }
  if (url.includes("\\")) {
    throw new Error(`YIELD_LENS_BASE_URL must not include backslashes: ${shown}`);
  }
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

/** Blank / whitespace / trailing slashes or backslashes → DEFAULT_BASE (or trimmed https root). */
export function resolveBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim() ?? "";
  if (!trimmed) return DEFAULT_BASE;
  const stripped = trimmed.replace(/[\\/]+$/, "");
  if (!stripped) return DEFAULT_BASE;
  assertPublicHttpsBaseUrl(stripped);
  return new URL(stripped).href.replace(/\/+$/, "");
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
const UNSAFE_LABEL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u00ad\u034f\u180b-\u180d\u180f\u200b\u2060\u2064\ufe00-\ufe0f\ufeff\u{1bca0}-\u{1bca3}\u{e0100}-\u{e01ef}\s\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]+/gu;

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
 * Coerce metrics for display. Finite numbers pass through; NaN/±Infinity → NaN
 * (rendered as "?" by fmtNum). Non-empty decimal strings are accepted;
 * hex/octal/binary strings (Number("0x10") === 16, e.g. raw on-chain quantities),
 * booleans/arrays/objects/blank → NaN.
 */
function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && DECIMAL_STRING.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

export function capUntrustedText(value: unknown): string {
  if (typeof value !== "string") return "";
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
    .filter(isRecord)
    .slice(0, MAX_SUMMARY_ROWS)
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
    .slice(0, MAX_SUMMARY_ROWS)
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

/**
 * Build one plain masked line for a failed request. undici embeds the raw
 * input URL (with any userinfo) in some error messages, so the URL must go
 * through redactUrlCredentials; a Node system errno (ECONNREFUSED, ...)
 * carries no secrets and is kept for debuggability.
 */
function requestFailedError(url: string, err: unknown): Error {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const code =
    typeof (cause as { code?: unknown } | null)?.code === "string"
      ? (cause as { code: string }).code
      : typeof (err as { code?: unknown } | null)?.code === "string"
        ? (err as { code: string }).code
        : "";
  return new Error(
    `Request to ${redactUrlCredentials(url)} failed${code ? ` (${code})` : ""}`,
  );
}

export async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  // AbortSignal.timeout throws RangeError for negative, non-finite, fractional,
  // or >2^31-1 delays (and values above 2^31-1 emit a TimeoutOverflowWarning and
  // clamp to 1 in Node); fall back to the default so a bad caller-supplied
  // timeout keeps the offline-friendly failure path (summarizeYields catches
  // per-request rejections, but a synchronous throw would crash the CLI).
  const MAX_TIMEOUT_MS = 2_147_483_647;
  const ms =
    Number.isFinite(timeoutMs) &&
    Number.isInteger(timeoutMs) &&
    timeoutMs >= 0 &&
    timeoutMs <= MAX_TIMEOUT_MS
      ? timeoutMs
      : DEFAULT_FETCH_TIMEOUT_MS;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ms),
      // Following redirects would bypass assertPublicHttpsBaseUrl (a public https
      // root could 30x to http:// or a private/metadata host). Treat as failure.
      redirect: "error",
    });
  } catch (err) {
    // undici throws TypeError("Failed to parse URL from <input>") with the raw
    // input embedded — echoing any userinfo — while connection failures throw
    // TypeError("fetch failed") with an errno `code` on the cause. Do not let
    // the raw message escape: emit one plain line with the credentials masked.
    throw requestFailedError(url, err);
  }
  if (!res.ok) {
    // The body was never consumed; cancel it so it also releases the
    // connection instead of lingering on the (dead) status-promise payload.
    await res.body?.cancel().catch(() => {});
    // Mask embedded userinfo so a caller-supplied URL cannot leak secrets in
    // the error (summarizeYields validates its base, but fetchJson is public).
    throw new Error(`HTTP ${res.status} for ${redactUrlCredentials(url)}`);
  }
  const tooLarge = `HTTP body exceeds ${MAX_RESPONSE_BYTES} bytes for ${redactUrlCredentials(url)}`;
  const rawLen = res.headers.get("content-length");
  const declared =
    rawLen !== null && /^\d+$/.test(rawLen.trim()) ? Number(rawLen.trim()) : Number.NaN;
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Error(tooLarge);
  }
  // Stream the body so a chunked / unknown-length response cannot fill the heap
  // before the size check: cancel the download as soon as it exceeds the cap.
  const reader = res.body?.getReader();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    // Sentinel so the catch below can tell our own size-cap error apart from
    // failures thrown by the underlying stream.
    const tooLargeError = new Error(tooLarge);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw tooLargeError;
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (err) {
      if (err === tooLargeError) throw err;
      // Body-stream failures (e.g. undici "terminated", or a custom fetchImpl's
      // stream error) may embed the raw URL with userinfo — mask them the same
      // way fetch-level failures are masked.
      throw requestFailedError(url, err);
    } finally {
      reader.releaseLock();
    }
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(tooLarge);
  }
  // Some servers prepend a UTF-8 BOM; JSON.parse rejects it, so strip it.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Do not rethrow the raw SyntaxError: it carries no URL context and would
    // look different from every other fetchJson failure. The body itself is
    // not echoed — it is untrusted and may be huge.
    throw new Error(`Invalid JSON in response from ${redactUrlCredentials(url)}`);
  }
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
  // Both requests are independent: issue them concurrently so a slow endpoint
  // does not add its latency on top of the other (worst case drops from 2x to
  // 1x the per-request timeout).
  const [pools, lending] = await Promise.all([
    fetchJson<unknown>(`${baseUrl}/pools`, fetchImpl, timeoutMs)
      .then((v) => normalizePools(v))
      .catch(() => [] as PoolSnapshot[]),
    fetchJson<unknown>(`${baseUrl}/lending`, fetchImpl, timeoutMs)
      .then((v) => normalizeLending(v))
      .catch(() => [] as LendingSnapshot[]),
  ]);

  return {
    chain: "base",
    pools,
    lending,
    fetchedAt: new Date().toISOString(),
  };
}

export function formatSummary(s: YieldLensSummary): string {
  const s0 =
    s && typeof s === "object" ? (s as Partial<YieldLensSummary>) : {};
  const fetchedAt = capUntrustedText(s0.fetchedAt);
  // Cap rendered rows as well as fetched rows: normalizePools/normalizeLending
  // cap at MAX_SUMMARY_ROWS, but formatSummary is exported and may be called
  // with a caller-built summary — an unbounded array would flood stdout/logs.
  // Drop null/non-object/array elements (same guard as normalize*) so caller-
  // built summaries cannot render junk "?" rows or crash on malformed entries.
  const pools = (Array.isArray(s0.pools) ? s0.pools : [])
    .filter(isRecord)
    .slice(0, MAX_SUMMARY_ROWS);
  const lending = (Array.isArray(s0.lending) ? s0.lending : [])
    .filter(isRecord)
    .slice(0, MAX_SUMMARY_ROWS);
  const lines = [
    `Base yield lens @ ${fetchedAt}`,
    `Pools: ${pools.length}`,
    ...pools.map((p) => {
      const asOf = capUntrustedText(p?.asOf);
      const suffix = asOf ? ` @ ${asOf}` : "";
      return `  - [${fmtLabel(p?.protocol)}] ${fmtLabel(p?.symbol)} TVL=$${fmtNum(asNumber(p?.tvlUsd), 0)} APR=${fmtNum(asNumber(p?.aprPct), 2)}%${suffix}`;
    }),
    `Lending: ${lending.length}`,
    ...lending.map((m) => {
      const asOf = capUntrustedText(m?.asOf);
      const suffix = asOf ? ` @ ${asOf}` : "";
      return `  - [${fmtLabel(m?.protocol)}] ${fmtLabel(m?.market)} supply=${fmtNum(asNumber(m?.supplyApyPct), 2)}% borrow=${fmtNum(asNumber(m?.borrowApyPct), 2)}%${suffix}`;
    }),
  ];
  return lines.join("\n");
}
