import { isNonPublicHostname, embeddedIpv4Address, redactUrlCredentials, assertPublicHttpsBaseUrl } from "./src/lib/fetch.ts";
const cases = [
  "home.arpa", "foo.home.arpa", "localhost.localdomain", "local", "localdomain",
  "0x7f000001", "127.0.0.1%0", "127.0.0.1.", "127.0.0.1..", "::ffff:127.0.0.1",
  "0177.0.0.1", "0x7f.1", "2130706433", "017700000001", "127.0.0.1:8080",
  "[::1]:8080", "fd00::1", "fe80::1%25eth0", "fec0::1", "ff02::1",
  "example.com.", "EXAMPLE.COM", "example.com:443", "198.51.100.7", "203.0.113.7",
  "100.64.0.1", "192.0.0.7", "192.0.2.1", "198.18.0.1",
  "::ffff:0:127.0.0.1", "64:ff9b::127.0.0.1", "64:ff9b:1::1", "2002:7f00:1::",
  "0:0:0:0:0:ffff:127.0.0.1", "::127.0.0.1", "::0.0.0.0", "::1.2.3.4",
  "evil.com@127.0.0.1", "127.0.0.1#", "127.0.0.1?", " 127.0.0.1 ",
  "10.0.0.1.", "169.254.169.254", "0.0.0.0", "255.255.255.255", "240.0.0.1",
  "224.0.0.1", "metadata.google.internal", "foo.localhost", "something.local",
  "fc00::1", "fd00::", "FE80::1", "0:0:0:0:0:0:0:1", "127.1", "127.0.1",
  "[v6.fe80::1]", "xn--80ak6aa92e.com", "0x7f.0x0.0x0.0x1",
  "1.1.1.1", "8.8.8.8", "example.com", "10.api.example.com",
];
for (const c of cases) {
  let r; try { r = isNonPublicHostname(c); } catch (e) { r = "THROW " + (e as Error).message; }
  console.log(JSON.stringify(c).padEnd(34), String(r).padEnd(6), "  embedded=" + JSON.stringify(embeddedIpv4Address(c)));
}
