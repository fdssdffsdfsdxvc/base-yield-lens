import { isNonPublicHostname, embeddedIpv4Address } from "./src/lib/fetch.ts";
for (const h of ["::0.0.0.0", "[::0.0.0.0]", "::0.0.0.1", "[::0.0.0.1]", "::0.0.0.2", "::0.0.1.0"]) {
  let url = "";
  try { url = new URL("http://" + (h.includes(":") && !h.startsWith("[") ? `[${h}]` : h) + "/").hostname; } catch (e) { url = "FAIL"; }
  console.log(JSON.stringify(h).padEnd(16), "url=" + url.padEnd(10), "isNonPublic=" + String(isNonPublicHostname(h)), "embedded=" + embeddedIpv4Address(h));
}
