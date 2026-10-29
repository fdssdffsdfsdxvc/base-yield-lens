import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CLI_USAGE, neutralizeUnsafeCliChars, parseCliArgs } from "../src/cliArgs.js";

describe("neutralizeUnsafeCliChars", () => {
  it("replaces terminal control characters with spaces", () => {
    expect(neutralizeUnsafeCliChars("\u001b[31mevil\u001b[0m")).toBe(" [31mevil [0m");
    expect(neutralizeUnsafeCliChars("a\r\nPools: 999")).toBe("a Pools: 999");
    expect(neutralizeUnsafeCliChars("A\u0007B\u007fC\u009bD")).toBe("A B C D");
    expect(neutralizeUnsafeCliChars("USDC\u202egnp.exe")).toBe("USDC gnp.exe");
    expect(neutralizeUnsafeCliChars("aerodrome\u2028line\u2029break")).toBe(
      "aerodrome line break",
    );
    expect(neutralizeUnsafeCliChars("plain message")).toBe("plain message");
  });
});

describe("parseCliArgs", () => {
  it("accepts empty argv (run summary)", () => {
    expect(parseCliArgs([])).toEqual({ help: false });
  });

  it("treats --help and -h as help", () => {
    expect(parseCliArgs(["--help"])).toEqual({ help: true });
    expect(parseCliArgs(["-h"])).toEqual({ help: true });
  });

  it("rejects unknown flags with a clear error", () => {
    expect(() => parseCliArgs(["--json"])).toThrow(/Unknown argument: --json/);
    expect(() => parseCliArgs(["--json"])).toThrow(/--help/);
    expect(() => parseCliArgs(["foo"])).toThrow(/Unknown argument: foo/);
  });

  it("ignores a bare -- end-of-options marker (pnpm cli -- --help)", () => {
    expect(parseCliArgs(["--"])).toEqual({ help: false });
    expect(parseCliArgs(["--", "--help"])).toEqual({ help: true });
    expect(parseCliArgs(["--help", "--"])).toEqual({ help: true });
    expect(() => parseCliArgs(["--", "--json"])).toThrow(/Unknown argument: --json/);
  });

  it("rejects empty or whitespace-only arguments", () => {
    expect(() => parseCliArgs([""])).toThrow(/Empty argument is not allowed/);
    expect(() => parseCliArgs(["   "])).toThrow(/Empty argument is not allowed/);
    expect(() => parseCliArgs(["--help", ""])).toThrow(/Empty argument is not allowed/);
  });
});

describe("CLI_USAGE", () => {
  it("documents bin name and YIELD_LENS_BASE_URL", () => {
    expect(CLI_USAGE).toContain("base-yield-lens");
    expect(CLI_USAGE).toContain("YIELD_LENS_BASE_URL");
    expect(CLI_USAGE).toContain("--help");
  });
});

describe("CLI stderr hardening (end-to-end)", () => {
  /** Run src/cli.ts via tsx and return its stderr for a failing invocation. */
  const cliErrorStderr = (
    argv: string[],
    env: Record<string, string> = {},
  ): string => {
    try {
      execFileSync("node_modules/.bin/tsx", ["src/cli.ts", ...argv], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      throw new Error("expected the CLI to exit non-zero");
    } catch (e) {
      const err = e as { stderr?: { toString(encoding: string): string } };
      if (!err.stderr) throw e;
      // console.error appends one final newline after the sanitized message.
      return err.stderr.toString("utf8").trimEnd();
    }
  };

  it("never echoes control characters from untrusted argv in error output", () => {
    const stderr = cliErrorStderr(["\u001b[31mevil\u001b[0m\nPools: 999"]);
    // The remainder of the value is still echoed (controls → spaces).
    expect(stderr).toMatch(/Unknown argument: +\[31mevil \[0m Pools: 999/);
    expect(stderr).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
  });

  it("never echoes control characters from untrusted YIELD_LENS_BASE_URL errors", () => {
    for (const bad of ["\u001b[31mnot-a-url", "https://9.f\u001b[0m.tr/private-host"]) {
      const stderr = cliErrorStderr([], {
        YIELD_LENS_BASE_URL: `${bad}\n`,
      });
      expect(stderr).toMatch(/YIELD_LENS_BASE_URL must /);
      expect(stderr).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    }
  });
});
