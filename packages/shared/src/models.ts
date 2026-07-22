/**
 * Modell-Registry. werknario ist nicht auf einen Anbieter festgelegt: dieser
 * Katalog beschreibt jedes einsetzbare Modell mit Anbieter, Preis, Kontextfenster,
 * Tool-Use-Fähigkeit und — für DSGVO entscheidend — seiner Datenresidenz. Der
 * Token-Zähler (tokens.ts) rechnet über diesen Katalog, der Router (routing.ts)
 * wählt daraus. Ein weiteres Modell (Kimi, Mistral, ...) ist ein Eintrag hier,
 * kein Umbau am Agenten.
 *
 * Preise sind der Anthropic-Listenpreis pro 1 Mio. Token, Stand im Feld
 * `verifiedOn`. Der Bedrock-EU-Regional-Aufschlag (+10 %) ist NICHT eingerechnet;
 * er wird beim Schätzen als Flag übergeben (estimateCostUsd), weil er vom
 * genutzten Endpunkt abhängt, nicht vom Modell.
 */

export type ProviderKind = "anthropic" | "bedrock" | "openai-compatible" | "mock";

/**
 * Wo die Verarbeitung stattfindet, aus DSGVO-Sicht:
 * - "eu": Anbieter garantiert EU-Datenresidenz (z. B. Bedrock EU, Mistral EU).
 * - "self-host": offene Gewichte, in der EU selbst betreibbar.
 * - "non-eu": nur über einen Nicht-EU-Endpunkt erreichbar — für personenbezogene
 *   Daten nicht ohne Weiteres zulässig.
 */
export type DataResidency = "eu" | "self-host" | "non-eu";

export interface ModelPrice {
  /** USD pro 1 Mio. Input-Token (nicht gecacht). */
  inputPerMTok: number;
  /** USD pro 1 Mio. Output-Token. */
  outputPerMTok: number;
  /** USD pro 1 Mio. neu in den Cache geschriebene Token (5-Min-TTL, Standard). */
  cacheWritePerMTok?: number;
  /** USD pro 1 Mio. aus dem Cache gelesene Token. */
  cacheReadPerMTok?: number;
  /** Zugriffsdatum der Preisprüfung. Preise ändern sich — danach neu prüfen. */
  verifiedOn: string;
  note?: string;
}

export interface ModelSpec {
  /** Kanonischer Kurzname und Katalog-Schlüssel, z. B. "claude-sonnet-5". */
  id: string;
  label: string;
  provider: ProviderKind;
  /**
   * Muster, die eine rohe Modell-ID des Anbieters diesem Eintrag zuordnen
   * (Teilstring). So findet der Zähler den Preis auch für eine volle Bedrock-ID
   * wie "eu.anthropic.claude-sonnet-5-...-v1:0".
   */
  match: string[];
  contextWindow: number;
  /** Bietet das Modell verlässliches Tool-Use? Ohne das taugt es für den Agenten nicht. */
  supportsTools: boolean;
  dataResidency: DataResidency;
  /** Verifizierter Preis, oder null wenn (noch) nicht belegt. */
  price: ModelPrice | null;
}

const ANTHROPIC_VERIFIED = "2026-07-22";

/**
 * Aktuell belegte Modelle. Anthropic-Preise an platform.claude.com verifiziert
 * (Stand 2026-07-22); Sonnet 5 steht bis 2026-08-31 im Einführungspreis, danach
 * $3/$15. Weitere Modelle (Kimi, Mistral, ...) kommen als eigene Einträge hinzu,
 * sobald ihre Preise und ihre Datenresidenz verifiziert sind.
 */
export const MODELS: ModelSpec[] = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "bedrock",
    match: ["haiku-4-5"],
    contextWindow: 200_000,
    supportsTools: true,
    dataResidency: "eu",
    price: {
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
      verifiedOn: ANTHROPIC_VERIFIED,
    },
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "bedrock",
    match: ["sonnet-5"],
    contextWindow: 1_000_000,
    supportsTools: true,
    dataResidency: "eu",
    price: {
      inputPerMTok: 2,
      outputPerMTok: 10,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      verifiedOn: ANTHROPIC_VERIFIED,
      note: "Einführungspreis bis 2026-08-31; danach $3/$15.",
    },
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "bedrock",
    match: ["opus-4-8"],
    contextWindow: 1_000_000,
    supportsTools: true,
    dataResidency: "eu",
    price: {
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheWritePerMTok: 6.25,
      cacheReadPerMTok: 0.5,
      verifiedOn: ANTHROPIC_VERIFIED,
    },
  },
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    provider: "bedrock",
    match: ["fable-5"],
    contextWindow: 1_000_000,
    supportsTools: true,
    dataResidency: "eu",
    price: {
      inputPerMTok: 10,
      outputPerMTok: 50,
      cacheWritePerMTok: 12.5,
      cacheReadPerMTok: 1,
      verifiedOn: ANTHROPIC_VERIFIED,
      note: "Teurer als Opus; nicht der Standardfall.",
    },
  },

  // Weitere Modelle (nicht Claude). Belege in werknario/docs/research/
  // 2026-07-22-mehr-modelle-kimi-und-andere.md. Datenresidenz ist eine Eigenschaft
  // der Anbieter-Route, nicht des Modells — dieselbe Familie kann zwei Einträge
  // haben: einen EU-Weg und einen billigen nicht-EU-Direktweg (nur ohne
  // Personenbezug). Preise, wo aggregiert oder noch offen, ehrlich als null oder
  // im note-Feld markiert.
  //
  // Matching-Prinzip (fail-safe): die "sicheren" Einträge (self-host, EU-über-
  // Hoster) matchen NUR ihre explizite kanonische ID. Ein roher, vom Anbieter
  // zurückgegebener Modellname (z. B. "moonshotai/Kimi-K2-Instruct") fällt damit
  // auf den nicht-EU-Direkteintrag zurück — richtig bepreist und bei der
  // DSGVO-Prüfung als non-eu behandelt, statt fälschlich als EU-sicher.
  {
    id: "mistral-large-3",
    label: "Mistral Large 3",
    provider: "openai-compatible",
    match: ["mistral-large-3", "mistral-large-2512"],
    contextWindow: 256_000,
    supportsTools: true,
    dataResidency: "eu",
    price: {
      inputPerMTok: 0.5,
      outputPerMTok: 1.5,
      verifiedOn: "2026-07-22",
      note: "docs.mistral.ai (mistral-large-3-25-12), Apache 2.0, La Plateforme Paris als EU-Route.",
    },
  },
  {
    id: "qwen3-coder-ovhcloud",
    label: "Qwen3-Coder (OVHcloud AI Endpoints)",
    provider: "openai-compatible",
    match: ["qwen3-coder-ovhcloud"], // nur explizit; sichere EU-Route

    contextWindow: 256_000,
    supportsTools: true,
    dataResidency: "eu",
    price: null, // OVHcloud-Preis nicht Teil der Recherche; vor Rollout prüfen.
  },
  {
    id: "deepseek-v4-flash-ovhcloud",
    label: "DeepSeek V4-Flash (OVHcloud AI Endpoints)",
    provider: "openai-compatible",
    match: ["deepseek-v4-flash-ovhcloud"], // nur explizit; sichere EU-Route

    contextWindow: 1_000_000,
    supportsTools: true,
    dataResidency: "eu",
    price: null, // OVHcloud-Preis nicht Teil der Recherche; vor Rollout prüfen.
  },
  {
    id: "deepseek-v4-flash-direct",
    label: "DeepSeek V4-Flash (deepseek.com direkt, nicht-EU)",
    provider: "openai-compatible",
    match: ["deepseek-chat", "deepseek-reasoner"],
    contextWindow: 1_000_000,
    supportsTools: true,
    dataResidency: "non-eu",
    price: {
      inputPerMTok: 0.14,
      outputPerMTok: 0.28,
      cacheReadPerMTok: 0.0028,
      verifiedOn: "2026-07-22",
      note: "api-docs.deepseek.com. Nur für Workloads ohne Personenbezug.",
    },
  },
  {
    id: "kimi-k2-instruct-selfhost",
    label: "Kimi-K2-Instruct (Eigenbetrieb EU)",
    provider: "openai-compatible",
    match: ["kimi-k2-instruct-selfhost"], // nur explizit; sichere Self-Host-Route

    contextWindow: 128_000,
    supportsTools: true,
    dataResidency: "self-host",
    price: null, // Reine Rechenkosten (~8x H200 FP8), kein Token-Preis.
  },
  {
    id: "kimi-k2-direct",
    label: "Kimi K2 (moonshot/kimi.ai direkt, nicht-EU)",
    provider: "openai-compatible",
    match: ["kimi-k2", "moonshotai/kimi"],
    contextWindow: 128_000,
    supportsTools: true,
    dataResidency: "non-eu",
    price: {
      inputPerMTok: 0.55,
      outputPerMTok: 2.2,
      verifiedOn: "2026-07-22",
      note: "Aggregator-Preis, nicht an platform.kimi.ai bestätigt. Nur ohne Personenbezug; kein EU-Hoster gefunden.",
    },
  },
];

/** Nachschlagen per kanonischem Schlüssel. */
export function getModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * Führt eine rohe Modell-ID (kanonischer Name oder volle Anbieter-ID) auf den
 * kanonischen Katalog-Schlüssel zurück, oder undefined wenn unbekannt.
 */
export function canonicalModelId(raw: string): string | undefined {
  const direct = getModel(raw);
  if (direct) return direct.id;
  // Provider-IDs kommen gemischt (z. B. "moonshotai/Kimi-K2-Instruct") — der
  // Vergleich ist deshalb ohne Rücksicht auf Groß-/Kleinschreibung.
  const lower = raw.toLowerCase();
  const hit = MODELS.find((m) =>
    m.match.some((frag) => lower.includes(frag.toLowerCase())),
  );
  return hit?.id;
}
