import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { LlmRequest } from "@werknario/shared";
import type { Provider } from "./providers/index.js";

/** Length-checked constant-time string compare, to avoid a timing side-channel on the bearer token. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface AppConfig {
  provider: Provider;
  /** Reported on GET /health, e.g. "mock" | "anthropic" | "bedrock". */
  providerName: string;
  /** Reported on GET /health. */
  model: string;
  /** Bearer token POST /v1/agent/message requires. Undefined = reject everything. */
  bearerToken: string | undefined;
  /** "*" reflects any request Origin; otherwise an explicit allow-list. */
  allowedOrigins: string[] | "*";
}

function corsMiddleware(allowedOrigins: string[] | "*") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    const allowOrigin =
      allowedOrigins === "*"
        ? origin ?? "*"
        : typeof origin === "string" && allowedOrigins.includes(origin)
          ? origin
          : undefined;

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
      res.status(204).end();
      return;
    }

    next();
  };
}

function requireBearer(bearerToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!bearerToken || !provided || !safeEqual(provided, bearerToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

function isLlmRequest(body: unknown): body is LlmRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { messages?: unknown }).messages)
  );
}

/** Builds the Express app. Split from server.ts so tests can inject a provider
 * without binding a port. */
export function createApp(config: AppConfig): express.Express {
  const app = express();

  app.use(corsMiddleware(config.allowedOrigins));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      provider: config.providerName,
      model: config.model,
    });
  });

  app.post(
    "/v1/agent/message",
    requireBearer(config.bearerToken),
    async (req: Request, res: Response) => {
      if (!isLlmRequest(req.body)) {
        res.status(400).json({ error: "Request body must include a messages array" });
        return;
      }

      try {
        const response = await config.provider.createMessage(req.body);
        res.status(200).json(response);
      } catch {
        // Never leak provider error details — they may contain the API key
        // or infrastructure details.
        res.status(502).json({ error: "Upstream LLM provider error" });
      }
    }
  );

  // Malformed JSON bodies land here via express.json()'s parse error.
  app.use((_err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next();
      return;
    }
    res.status(400).json({ error: "Invalid request body" });
  });

  return app;
}
