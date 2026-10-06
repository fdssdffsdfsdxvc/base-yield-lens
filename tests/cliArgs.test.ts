import { describe, expect, it } from "vitest";
import { CLI_USAGE, parseCliArgs } from "../src/cliArgs.js";

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
