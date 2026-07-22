import { describe, expect, it } from "vitest";
import { verifyWithCommand } from "../src/shellVerify.js";

describe("verifyWithCommand", () => {
  it("passes on a zero exit code", async () => {
    expect(await verifyWithCommand("exit 0")).toEqual({ ok: true });
  });

  it("fails on a non-zero exit code and reports a detail", async () => {
    const r = await verifyWithCommand("exit 3");
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it("captures stderr output on failure", async () => {
    const r = await verifyWithCommand("echo boom 1>&2; exit 1");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/boom/);
  });
});
