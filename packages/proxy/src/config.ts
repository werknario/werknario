import "dotenv/config";

export type ProviderName =
  | "mock"
  | "anthropic"
  | "bedrock"
  | "openai-compatible";

export interface ProxyConfig {
  provider: ProviderName;
  model: string;
  bearerToken: string | undefined;
  port: number;
  allowedOrigins: string[] | "*";
  anthropic: {
    apiKey: string | undefined;
  };
  bedrock: {
    region: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  };
  /** Für jeden OpenAI-kompatiblen Endpunkt (Mistral, Kimi, DeepSeek, Qwen, vLLM). */
  openaiCompatible: {
    baseUrl: string | undefined;
    apiKey: string | undefined;
  };
}

function parseAllowedOrigins(raw: string | undefined): string[] | "*" {
  const value = (raw ?? "*").trim();
  if (value === "" || value === "*") return "*";
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseProvider(raw: string | undefined): ProviderName {
  if (
    raw === "anthropic" ||
    raw === "bedrock" ||
    raw === "mock" ||
    raw === "openai-compatible"
  ) {
    return raw;
  }
  return "mock";
}

/** Reads proxy configuration from process.env. Never logs secret values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  return {
    provider: parseProvider(env.LLM_PROVIDER),
    model: env.LLM_MODEL || "claude-sonnet-5",
    bearerToken: env.PROXY_BEARER_TOKEN,
    port: env.PROXY_PORT ? Number(env.PROXY_PORT) : 9109,
    allowedOrigins: parseAllowedOrigins(env.PROXY_ALLOWED_ORIGINS),
    anthropic: {
      apiKey: env.CLAUDE_API_TOKEN || env.ANTHROPIC_API_KEY,
    },
    bedrock: {
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    openaiCompatible: {
      baseUrl: env.LLM_OPENAI_COMPAT_BASE_URL,
      apiKey: env.LLM_OPENAI_COMPAT_API_KEY,
    },
  };
}
