/** CLI usage for base-yield-lens (stdout via caller). */
export const CLI_USAGE = `base-yield-lens — read-only Base DeFi yield summary

Usage:
  base-yield-lens [--help|-h] [--version|-v]

Env:
  YIELD_LENS_BASE_URL  Optional https API root (blank → built-in placeholder).
                       Must be absolute https with a host; no credentials,
                       private hosts, query, or hash.

Not financial advice. Placeholder APIs until real Base endpoints are wired.
`;

export type ParsedCliArgs = { help: boolean; version: boolean };

/**
 * C0/DEL/C1 controls (ANSI escapes, CR/LF, BEL) plus Unicode line/paragraph
 * separators and bidi overrides. Error messages echo untrusted input (argv
 * values, YIELD_LENS_BASE_URL) and are printed to a terminal: an ESC sequence
 * could recolor/clear the screen, and CR/LF/U+2028/U+2029 could forge extra
 * error lines.
 */
const UNSAFE_TERMINAL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u00ad\u034f\u180b-\u180d\u180f\u200b\u2060\u2064\ufe00-\ufe0f\ufeff\u{1bca0}-\u{1bca3}\u{e0100}-\u{e01ef}\s\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]+/gu;

/** Cap on CLI error length: a huge untrusted argv/env value must not flood stderr. */
export const MAX_CLI_ERROR_LENGTH = 512;

/**
 * Neutralize control characters in error text before it is printed to stderr.
 * Intentional line breaks in our own messages become single spaces, so the
 * resulting error is one plain line the terminal cannot misinterpret.
 * Capped at MAX_CLI_ERROR_LENGTH to avoid flooding stderr with untrusted input.
 */
export function neutralizeUnsafeCliChars(message: string): string {
  const neutralized = message.replace(UNSAFE_TERMINAL_CHARS, " ");
  if (neutralized.length <= MAX_CLI_ERROR_LENGTH) return neutralized;
  const head = neutralized.slice(0, MAX_CLI_ERROR_LENGTH - 1);
  const capped = /[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head;
  return `${capped}…`;
}

/** Parse argv after node/script (e.g. process.argv.slice(2)). */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let help = false;
  let version = false;
  for (const arg of argv) {
    // `pnpm cli -- --help` forwards the bare "--" end-of-options marker; skip it.
    if (arg === "--") continue;
    if (arg.trim() === "") {
      throw new Error("Empty argument is not allowed\nUse --help for usage.");
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\nUse --help for usage.`);
  }
  return { help, version };
}
