#!/usr/bin/env node
import { parseCliArgs, CLI_USAGE } from "./cliArgs.js";
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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
