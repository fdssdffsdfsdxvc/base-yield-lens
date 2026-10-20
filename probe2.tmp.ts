import { isNonPublicHostname, assertPublicHttpsBaseUrl } from "./src/lib/fetch.ts";
for (const h of ["[::0.0.0.1]", "[::0.0.0.0]", "[::1]", "[::]", "::0.0.0.1", "::0.0.0.0", "[0:0:0:0:0:0:0:1]"]) {
  let u = "";
  try { u = new URL(`https://${h}/`).hostname; } catch (e) { u = "PARSE-FAIL"; }
  let rej = "";
  try { assertPublicHttpsBaseUrl(`https://${h}/`); rej = "ACCEPTED"; } catch (e) { rej = "rejected: " + (e as Error).message; }
  console.log(JSON.stringify(h).padEnd(26), "urlHost=" + u.padEnd(18), "isNonPublic=" + String(isNonPublicHostname(h)).padEnd(5), rej);
}
