/** CLI usage for base-yield-lens (stdout via caller). */
export const CLI_USAGE = `base-yield-lens — read-only Base DeFi yield summary

Usage:
  base-yield-lens [--help|-h]

Env:
  YIELD_LENS_BASE_URL  Optional https API root (blank → built-in placeholder).
                       Must be absolute https with a host; no credentials.

Not financial advice. Placeholder APIs until real Base endpoints are wired.
`;

export type ParsedCliArgs = { help: boolean };

/** Parse argv after node/script (e.g. process.argv.slice(2)). */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\nUse --help for usage.`);
  }
  return { help };
}
