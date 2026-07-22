/**
 * Deterministischer Modell-Router. Der Agent soll pro Aufgabe selbst das passende
 * Modell wählen — günstig für Einfaches, stark für Sensibles — ohne dass ein
 * Nicht-Techniker etwas einstellt und ohne einen zusätzlichen Klassifikator-Aufruf.
 * Die Regel ist reiner Code, in einem Merge Request nachlesbar.
 *
 * Anbieter-agnostisch: welche Modelle je Stufe genutzt werden, steht in der
 * Policy (modelByTier). Standard sind Claude-Stufen über Bedrock EU; man kann
 * Kimi, Mistral oder ein selbst gehostetes Modell einsetzen, indem man die Policy
 * ändert — der Code hier bleibt gleich. Der DSGVO-Wächter (validateRoutingPolicy)
 * verhindert, dass versehentlich ein Modell ohne EU-Datenresidenz eingetragen wird.
 */

import { canonicalModelId, getModel } from "./models.js";
import type { TokenTotals } from "./tokens.js";
import { isToolUseBlock, type Message } from "./types.js";

export type Tier = "simple" | "standard" | "high";

const TIER_ORDER: Tier[] = ["simple", "standard", "high"];

export interface RoutingSignals {
  /** Zuletzt genutztes/angefragtes Tool, oder null für einen freien Chat-Turn. */
  toolName: string | null;
  /** Betroffene Repo-Pfade (für die Sensible-Pfad-Regel). */
  filePaths: string[];
  /** Grobe Tokenzahl des aktuellen Requests (Umfangssignal). */
  contextTokens: number;
  /** Bisherige Kosten der laufenden Sitzung in USD (weiche Budget-Bremse). */
  sessionCostUsd: number;
}

export interface RoutingPolicy {
  /** Modell-ID je Stufe (kanonisch oder Anbieter-ID). */
  modelByTier: Record<Tier, string>;
  /** Pfade, die nie unter "standard" laufen (rechtlich/finanziell sensibel). */
  sensitivePathPrefixes: string[];
  /** Weiches Budget in USD: darüber wird eine Stufe heruntergeschaltet. 0 = aus. */
  softBudgetUsd: number;
  /** Nur Modelle mit EU-Residenz / self-host zulassen (DSGVO). Default an. */
  euOnly: boolean;
}

/** Claude über Bedrock EU, wie in CLAUDE.md gesetzt. Alle Stufen EU-konform. */
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  modelByTier: {
    simple: "claude-haiku-4-5",
    standard: "claude-sonnet-5",
    high: "claude-opus-4-8",
  },
  sensitivePathPrefixes: ["vertraege/", "verwaltung/"],
  softBudgetUsd: 0,
  euOnly: true,
};

function stepDown(tier: Tier): Tier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, i - 1)] ?? "simple";
}

/**
 * Wählt die Stufe nach festen Regeln. Reihenfolge der Regeln ist bewusst:
 * Lesen ist immer billig; sensible Pfade nie zu schwach; danach der Rest.
 * Zuletzt greift die weiche Budget-Bremse und schaltet eine Stufe herunter.
 */
export function selectTier(signals: RoutingSignals, policy: RoutingPolicy): Tier {
  let tier = baseTier(signals, policy);
  if (policy.softBudgetUsd > 0 && signals.sessionCostUsd >= policy.softBudgetUsd) {
    tier = stepDown(tier);
  }
  return tier;
}

function baseTier(signals: RoutingSignals, policy: RoutingPolicy): Tier {
  // Regel 1: reine Lesevorgänge sind immer simple.
  if (signals.toolName === "read_file" || signals.toolName === "list_files") {
    return "simple";
  }

  // Regel 2: sensible Pfade nie unter standard; bei Mehrfach-Änderung hoch.
  const touchesSensitive = signals.filePaths.some((p) =>
    policy.sensitivePathPrefixes.some((prefix) => p.startsWith(prefix)),
  );
  if (touchesSensitive) {
    return signals.filePaths.length > 1 ? "high" : "standard";
  }

  // Regel 3: mehrere Dateien gleichzeitig -> hohe Stufe.
  if (signals.filePaths.length > 3) return "high";

  // Regel 4: Vorschlags-/Schreib-Tools und MR/Kommentar sind Standard.
  if (
    signals.toolName === "propose_edit" ||
    signals.toolName === "write_file" ||
    signals.toolName === "create_merge_request" ||
    signals.toolName === "add_comment"
  ) {
    return "standard";
  }

  // Fallback: freier Chat-Turn ohne erkanntes Tool.
  return "standard";
}

export interface ModelChoice {
  tier: Tier;
  modelId: string;
}

/** Stufe wählen und daraus die konfigurierte Modell-ID nachschlagen. */
export function selectModel(
  signals: RoutingSignals,
  policy: RoutingPolicy,
): ModelChoice {
  const tier = selectTier(signals, policy);
  return { tier, modelId: policy.modelByTier[tier] };
}

/**
 * Ist das Modell DSGVO-konform erreichbar (EU-Residenz oder self-host)? Ein
 * unbekanntes Modell gilt bewusst als NICHT sicher — im Zweifel kein Datenabfluss.
 */
export function isEuSafe(modelId: string): boolean {
  const id = canonicalModelId(modelId);
  const spec = id ? getModel(id) : undefined;
  if (!spec) return false;
  return spec.dataResidency === "eu" || spec.dataResidency === "self-host";
}

/**
 * Prüft eine Policy vor dem Einsatz. Bei euOnly meldet sie jede Stufe, deren
 * Modell nicht EU-konform (oder unbekannt) ist. Das Deployment sollte mit einer
 * fehlerhaften Policy gar nicht erst starten.
 */
export function validateRoutingPolicy(policy: RoutingPolicy): string[] {
  const problems: string[] = [];
  if (!policy.euOnly) return problems;
  for (const tier of TIER_ORDER) {
    const modelId = policy.modelByTier[tier];
    if (!isEuSafe(modelId)) {
      problems.push(
        `Stufe "${tier}" nutzt "${modelId}" ohne belegte EU-Datenresidenz. ` +
          `Für personenbezogene Daten nicht zulässig (euOnly). Modell in die Registry ` +
          `aufnehmen mit dataResidency "eu"/"self-host" oder ein anderes Modell wählen.`,
      );
    }
  }
  return problems;
}

/**
 * Leitet Routing-Signale aus dem Nachrichtenverlauf ab, den der Loop ohnehin
 * hält: das zuletzt genutzte Tool und die betroffenen Pfade aus der letzten
 * Assistant-Runde mit Tool-Use. Das ist eine Heuristik ("die nächste Runde ähnelt
 * der letzten"), bewusst grob und deterministisch.
 */
export function signalsFromMessages(
  messages: Message[],
  sessionCostUsd: number,
): RoutingSignals {
  let toolName: string | null = null;
  const filePaths: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant" || !Array.isArray(m.content)) continue;
    const toolUses = m.content.filter(isToolUseBlock);
    if (toolUses.length === 0) continue;
    toolName = toolUses[toolUses.length - 1]?.name ?? null;
    for (const tu of toolUses) {
      const p = tu.input?.["path"];
      if (typeof p === "string") filePaths.push(p);
    }
    break;
  }
  return { toolName, filePaths, contextTokens: 0, sessionCostUsd };
}

/**
 * Baut aus einer Policy den per-Runde-Modellwähler, den der Loop erwartet
 * (`selectModelForTurn`). Damit lässt sich das Routing mit einer Zeile
 * aktivieren, ohne dass der Loop eine Routing-Policy kennt.
 */
export function makeSelectModelForTurn(
  policy: RoutingPolicy,
): (ctx: { messages: Message[]; totals: TokenTotals }) => string {
  return (ctx) =>
    selectModel(signalsFromMessages(ctx.messages, ctx.totals.costUsd), policy)
      .modelId;
}
