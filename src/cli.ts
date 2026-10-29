#!/usr/bin/env node
import { CLI_USAGE, neutralizeUnsafeCliChars, parseCliArgs } from "./cliArgs.js";
import { formatSummary, summarizeYields } from "./lib/fetch.js";

async function main() {
  const { help } = parseCliArgs(process.argv.slice(2));
  if (help) {
    console.log(CLI_USAGE.trimEnd());
    return;
  }

  const baseUrl = process.env.YIELD_LENS_BASE_URL;
  const summary = await summarizeYields({ baseUrl });
  console.log(formatSummary(summary));
  console.log(
    "\nNot financial advice. Placeholder APIs — set YIELD_LENS_BASE_URL when wiring real Base DeFi endpoints.",
  );
}

main().catch((err) => {
  // Error text embeds untrusted argv / YIELD_LENS_BASE_URL values (credentials
  // are already masked): neutralize control characters so it cannot rewrite
  // the terminal or forge extra error lines.
  console.error(neutralizeUnsafeCliChars(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
