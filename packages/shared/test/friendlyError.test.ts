import { describe, expect, it } from "vitest";
import { classifyError, friendlyError } from "../src/index.js";

describe("classifyError", () => {
  it("classifies an empty object as unknown", () => {
    expect(classifyError({})).toBe("unknown");
  });

  it("classifies a GitlabError-shaped object via its status/detail fields", () => {
    // Shape mirrors packages/gitlab-client's GitlabError: status/detail are
    // set directly, message is the combined "METHOD path → status: detail"
    // string GitlabClient builds. Classification should prefer status/detail
    // over re-parsing message.
    const gitlabError = {
      name: "GitlabError",
      status: 409,
      detail: "Branch already exists",
      message: "GitLab POST /repository/branches → 409: Branch already exists",
    };
    expect(classifyError(gitlabError)).toBe("branch_exists");
  });
});

describe("friendlyError: auth", () => {
  const input = { status: 401, detail: "Unauthorized" };

  it("en", () => {
    // omits the locale argument to also cover the "en" default
    const r = friendlyError(input);
    expect(r.code).toBe("auth");
    expect(r.message).toMatch(/access/i);
    expect(r.hint).toMatch(/token/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("auth");
    expect(r.message).toMatch(/zugriff/i);
    expect(r.hint).toMatch(/token/i);
  });
});

describe("friendlyError: permission", () => {
  const input = { status: 403, detail: "403 Forbidden" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("permission");
    expect(r.message).toMatch(/permission/i);
    expect(r.hint).toMatch(/administrator/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("permission");
    expect(r.message).toMatch(/berechtigung/i);
    expect(r.hint).toMatch(/administrator/i);
  });
});

describe("friendlyError: not_found", () => {
  // No status field at all: the code has to be reached through the "not
  // found" text pattern, not through a numeric status.
  const input = { detail: "Not Found" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("not_found");
    expect(r.message).toMatch(/could not be found/i);
    expect(r.hint).toMatch(/renamed|moved|deleted/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("not_found");
    expect(r.message).toMatch(/nicht gefunden/i);
    expect(r.hint).toMatch(/umbenannt|verschoben|gelöscht/i);
  });
});

describe("friendlyError: branch_exists", () => {
  const input = { status: 400, detail: "Branch already exists" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("branch_exists");
    expect(r.message).toMatch(/already exists/i);
    expect(r.hint).toMatch(/try again/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("branch_exists");
    expect(r.message).toMatch(/gibt es schon/i);
    expect(r.hint).toMatch(/neu versuchen/i);
  });
});

describe("friendlyError: conflict", () => {
  // Only `.message` is set (no status, no detail) - simulates a plain thrown
  // Error rather than a GitlabError, exercising the message-parsing fallback.
  const input = { message: "Merge conflict: cannot fast-forward" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("conflict");
    expect(r.message).toMatch(/cannot be merged automatically/i);
    expect(r.hint).toMatch(/resolve/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("conflict");
    expect(r.message).toMatch(/nicht automatisch zusammenführen/i);
    expect(r.hint).toMatch(/auflösen/i);
  });
});

describe("friendlyError: rate_limit", () => {
  const input = { status: 429, detail: "Rate limit exceeded" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("rate_limit");
    expect(r.message).toMatch(/too many requests/i);
    expect(r.hint).toMatch(/wait/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("rate_limit");
    expect(r.message).toMatch(/zu viele anfragen/i);
    expect(r.hint).toMatch(/warten/i);
  });
});

describe("friendlyError: server", () => {
  const input = { status: 502, detail: "Bad Gateway" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("server");
    expect(r.message).toMatch(/problem/i);
    expect(r.hint).toMatch(/try again/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("server");
    expect(r.message).toMatch(/problem/i);
    expect(r.hint).toMatch(/erneut versuchen/i);
  });
});

describe("friendlyError: unknown", () => {
  const input = { status: 418, detail: "I'm a teapot" };

  it("en", () => {
    const r = friendlyError(input, "en");
    expect(r.code).toBe("unknown");
    expect(r.message).not.toMatch(/teapot/i);
    expect(r.hint).toMatch(/try again/i);
  });

  it("de", () => {
    const r = friendlyError(input, "de");
    expect(r.code).toBe("unknown");
    expect(r.message).not.toMatch(/teapot/i);
    expect(r.hint).toMatch(/erneut versuchen/i);
  });
});
