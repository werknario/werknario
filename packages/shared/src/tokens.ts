/**
 * Token-Konto. Der Agent verwarf bisher jedes Nutzungssignal der API; hier läuft
 * ein einfaches, reines Konto: es zählt Token, rechnet über die Modell-Registry
 * (models.ts) in Kosten um und meldet, wenn ein Budget knapp wird. Kein externer
 * Dienst, kein Datenabfluss — passt zur DSGVO-Vorgabe und zum Minimalitäts-Prinzip.
 *
 * Bewusst beratend: der Zähler blockt nichts von sich aus. Ob und wie der Agent
 * bei "warn"/"over" reagiert (Modell herunterstufen, den Menschen fragen, stoppen),
 * entscheidet der Loop über sein Budget-Gate.
 */

import { canonicalModelId, getModel } from "./models.js";
import type { LlmUsage } from "./types.js";

/** Aufschlag des Bedrock-EU-Regional-Endpunkts gegenüber dem Listenpreis. */
const BEDROCK_EU_PREMIUM = 0.1;

/**
 * Nur endliche Zahlen durchlassen, sonst 0. Die usage-Felder kommen aus einer
 * ungeprüften HTTP-Antwort (openai-compatible castet roh). Ein String oder NaN
 * darf das Konto nicht vergiften — sonst würde eine einzige kaputte Antwort das
 * Budget-Gate lautlos für die ganze Sitzung ausschalten (fail-open).
 */
function toFinite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export interface CostEstimate {
  costUsd: number;
  /** true, wenn für dieses Modell kein verifizierter Preis vorliegt. */
  priceUnknown: boolean;
}

export interface EstimateOptions {
  /** Über den Bedrock-EU-Regional-Endpunkt? Dann +10 % (Datenresidenz-Aufschlag). */
  bedrockEu?: boolean;
}

/**
 * Kosten eines einzelnen Aufrufs in USD, nach den verifizierten Preisen der
 * Registry. Ist das Modell unbekannt, wird nichts erfunden: costUsd = 0 und
 * priceUnknown = true. Der Aufrufer sieht so ehrlich, dass hier eine Lücke ist.
 */
export function estimateCostUsd(
  usage: LlmUsage,
  model: string,
  opts: EstimateOptions = {},
): CostEstimate {
  const id = canonicalModelId(model);
  const spec = id ? getModel(id) : undefined;
  const price = spec?.price;
  if (!price) return { costUsd: 0, priceUnknown: true };

  const input = toFinite(usage.input_tokens);
  const output = toFinite(usage.output_tokens);
  const cacheWrite = toFinite(usage.cache_creation_input_tokens);
  const cacheRead = toFinite(usage.cache_read_input_tokens);

  const perTok = (perMTok: number | undefined) => (perMTok ?? 0) / 1_000_000;
  let cost =
    input * perTok(price.inputPerMTok) +
    output * perTok(price.outputPerMTok) +
    cacheWrite * perTok(price.cacheWritePerMTok) +
    cacheRead * perTok(price.cacheReadPerMTok);

  if (opts.bedrockEu) cost *= 1 + BEDROCK_EU_PREMIUM;
  return { costUsd: cost, priceUnknown: false };
}

export interface TokenTotals {
  calls: number;
  /** Aufrufe, für die kein verifizierter Preis vorlag (Kosten nicht gezählt). */
  unpricedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface TokenBudget {
  /** Kostenobergrenze in USD über die Lebensdauer dieses Kontos. */
  maxUsd: number;
  /** Anteil (0..1), ab dem gewarnt wird, z. B. 0.8. */
  warnAtRatio: number;
}

export type BudgetStatus = "ok" | "warn" | "over";

export interface TokenLedgerOptions {
  budget?: TokenBudget;
  /** Läuft die Sitzung über Bedrock EU? Dann rechnet das Konto mit +10 %. */
  bedrockEu?: boolean;
}

/**
 * Laufendes Konto über eine Konversation (oder einen Arbeitstag). Lebensdauer =
 * wie das Backend, kein globaler Zustand. record() nach jeder Modellantwort.
 */
export class TokenLedger {
  private readonly totalsAcc: TokenTotals = {
    calls: 0,
    unpricedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };

  constructor(private readonly opts: TokenLedgerOptions = {}) {}

  record(usage: LlmUsage, model: string): void {
    const t = this.totalsAcc;
    t.calls += 1;
    t.inputTokens += toFinite(usage.input_tokens);
    t.outputTokens += toFinite(usage.output_tokens);
    t.cacheWriteTokens += toFinite(usage.cache_creation_input_tokens);
    t.cacheReadTokens += toFinite(usage.cache_read_input_tokens);

    const { costUsd, priceUnknown } = estimateCostUsd(usage, model, {
      bedrockEu: this.opts.bedrockEu,
    });
    if (priceUnknown) t.unpricedCalls += 1;
    else t.costUsd += costUsd;
  }

  totals(): TokenTotals {
    return { ...this.totalsAcc };
  }

  /** Anteil des Budgets, der verbraucht ist (0 wenn kein Budget gesetzt). */
  ratioUsed(): number {
    const budget = this.opts.budget;
    if (!budget || budget.maxUsd <= 0) return 0;
    // Fail-safe: sollten die Kosten trotz Coercion nicht endlich sein, gilt das
    // Budget als überschritten, nicht als unberührt.
    if (!Number.isFinite(this.totalsAcc.costUsd)) return Infinity;
    return this.totalsAcc.costUsd / budget.maxUsd;
  }

  status(): BudgetStatus {
    const budget = this.opts.budget;
    if (!budget) return "ok";
    const ratio = this.ratioUsed();
    if (!Number.isFinite(ratio) || ratio >= 1) return "over";
    if (ratio >= budget.warnAtRatio) return "warn";
    return "ok";
  }
}
