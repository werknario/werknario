/**
 * In-memory backend for a zero-setup demo and offline smoke tests. With
 * LLM_PROVIDER=mock and WERKNARIO_BACKEND=mock the whole flow runs end to end
 * without any GitLab, GitHub, or model key. Seeded with the same session note the
 * mock provider expects, so the demo produces a split sheet and opens a
 * (pretend) merge request.
 */

import type { ToolBackend } from "@werknario/shared";
import type { MergeGateway } from "./closeLoop.js";

const SEED: Record<string, string> = {
  "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md":
    "# Session-Notiz — Landgang (2026-05-30)\n\n" +
    "Aufnahme im Proberaum. Beteiligte: Fiete Osterloh (Gesang, Text), " +
    "Mara Voss (Musik, Produktion).\n\n" +
    "Anteile am Split noch offen — bitte ableiten.\n",
};

export function mockBackend(
  seed: Record<string, string> = SEED,
): { backend: ToolBackend; gateway: MergeGateway } {
  const files = new Map<string, string>(Object.entries(seed));
  const staged = new Map<string, string>();
  let nextIid = 1;

  const backend: ToolBackend = {
    async listFiles(path) {
      const prefix = path ? path.replace(/\/?$/, "/") : "";
      const children = new Set<string>();
      for (const key of [...files.keys(), ...staged.keys()]) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        children.add(slash === -1 ? key : `${prefix}${rest.slice(0, slash)}/`);
      }
      return [...children].sort();
    },
    async readFile(path) {
      const v = staged.get(path) ?? files.get(path);
      if (v === undefined) throw new Error(`Datei nicht gefunden: ${path}`);
      return v;
    },
    async proposeEdit(path, content) {
      const isNew = !files.has(path);
      staged.set(path, content);
      return { path, isNew };
    },
    async createMergeRequest(args) {
      for (const [p, c] of staged) files.set(p, c);
      staged.clear();
      const iid = nextIid++;
      return { webUrl: `mock://merge-request/${iid}`, iid, sourceBranch: args.sourceBranch };
    },
    async addComment() {
      return {};
    },
  };

  const gateway: MergeGateway = {
    async checkMergeable() {
      return { mergeable: true };
    },
    async merge(iid) {
      return { sha: `mock-sha-${iid}` };
    },
    async revert(iid) {
      return { branch: `revert/mock-${iid}` };
    },
  };

  return { backend, gateway };
}
