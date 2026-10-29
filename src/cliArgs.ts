/** CLI usage for base-yield-lens (stdout via caller). */
export const CLI_USAGE = `base-yield-lens — read-only Base DeFi yield summary

Usage:
  base-yield-lens [--help|-h]

Env:
  YIELD_LENS_BASE_URL  Optional https API root (blank → built-in placeholder).
                       Must be absolute https with a host; no credentials,
                       private hosts, query, or hash.

Not financial advice. Placeholder APIs until real Base endpoints are wired.
`;

export type ParsedCliArgs = { help: boolean };

/**
 * C0/DEL/C1 controls (ANSI escapes, CR/LF, BEL) plus Unicode line/paragraph
 * separators and bidi overrides. Error messages echo untrusted input (argv
 * values, YIELD_LENS_BASE_URL) and are printed to a terminal: an ESC sequence
 * could recolor/clear the screen, and CR/LF/U+2028/U+2029 could forge extra
 * error lines.
 */
const UNSAFE_TERMINAL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

/**
 * Neutralize control characters in error text before it is printed to stderr.
 * Intentional line breaks in our own messages become single spaces, so the
 * resulting error is one plain line the terminal cannot misinterpret.
 */
export function neutralizeUnsafeCliChars(message: string): string {
  return message.replace(UNSAFE_TERMINAL_CHARS, " ");
}

/** Parse argv after node/script (e.g. process.argv.slice(2)). */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let help = false;
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
    throw new Error(`Unknown argument: ${arg}\nUse --help for usage.`);
  }
  return { help };
}
