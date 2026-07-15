import type { LlmCaller, LlmRequest, LlmResponse } from "@werknario/shared";

type FetchFn = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface ProxyConfig {
  url: string;
  token: string;
  fetchImpl?: FetchFn;
}

/**
 * Turn the proxy into an LlmCaller the agent loop can drive. The GitLab token
 * never goes here — only the proxy bearer token does. One model turn per call.
 */
export function createProxyCaller(cfg: ProxyConfig): LlmCaller {
  const base = cfg.url.replace(/\/+$/, "");
  const globalFetch = (globalThis as { fetch?: FetchFn }).fetch;
  const fetchImpl = cfg.fetchImpl ?? globalFetch;
  if (!fetchImpl) throw new Error("No fetch available for the proxy client.");

  return async (req: LlmRequest): Promise<LlmResponse> => {
    const res = await fetchImpl(`${base}/v1/agent/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new Error(`Proxy antwortete ${res.status}. ${detail}`);
    }
    return (await res.json()) as LlmResponse;
  };
}
