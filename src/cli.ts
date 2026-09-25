#!/usr/bin/env node
import { formatSummary, summarizeYields } from "./lib/fetch.js";

async function main() {
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
