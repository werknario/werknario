import type { IncomingMessage } from "node:http";

/**
 * Reads the full request body as a UTF-8 string, capped at `limitBytes`.
 *
 * Rejects if the body exceeds the cap or the underlying stream errors.
 * Used instead of a body-parsing middleware (e.g. express.json()) on
 * /vscode/gallery/extensionquery: a middleware that throws synchronously on
 * malformed or oversized input lands in Express's generic error handler and
 * turns into a 5xx, which the spec forbids for that route. Reading the raw
 * body ourselves means a bad body is just a rejected promise we can catch
 * and degrade gracefully from.
 */
export function readRawBody(req: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let tooLarge = false;
    let settled = false;

    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > limitBytes) {
        // Don't reject yet, and don't destroy the connection: cutting the
        // client off mid-write (or responding before it finishes sending)
        // reads back as a reset connection, not a clean HTTP response. Stop
        // buffering — memory stays bounded near `limitBytes` — but keep
        // draining until "end" so we only ever answer once the client is
        // actually done writing.
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (tooLarge) {
        reject(new Error("Request body too large"));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", fail);
  });
}
