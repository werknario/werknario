import { describe, expect, it } from "vitest";
import { resolveStorePath } from "../src/safePath.js";

describe("resolveStorePath", () => {
  const root = "/opt/store/unpacked";

  it("resolves a normal relative path under root", () => {
    expect(resolveStorePath(root, "extension/package.json")).toBe("/opt/store/unpacked/extension/package.json");
  });

  it("rejects a leading .. segment", () => {
    expect(resolveStorePath(root, "../secret")).toBeNull();
  });

  it("rejects a .. segment buried in the middle of the path", () => {
    expect(resolveStorePath(root, "extension/../../etc/passwd")).toBeNull();
  });

  it("rejects a bare ..", () => {
    expect(resolveStorePath(root, "..")).toBeNull();
  });

  it("rejects a null byte", () => {
    expect(resolveStorePath(root, "extension/package.json\0.txt")).toBeNull();
  });

  it("rejects a . segment", () => {
    expect(resolveStorePath(root, "./extension/package.json")).toBeNull();
  });
});
