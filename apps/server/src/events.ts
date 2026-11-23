import type { Request, Response } from "express";

const clients = new Set<Response>();

const MAX_SSE_CLIENTS = 50;

export function addSseClient(req: Request, res: Response): void {

  for (const c of clients) {
    if (c.writableEnded || c.destroyed) clients.delete(c);
  }
  if (clients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({
      error: { code: "TOO_MANY_STREAMS", message: "Quá nhiều kết nối realtime" },
    });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => {
    clients.delete(res);
  });

  res.on("error", () => {
    clients.delete(res);
  });
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

const heartbeat = setInterval(() => {
  for (const res of clients) {
    if (res.writableEnded || res.destroyed) {
      clients.delete(res);
      continue;
    }
    try {
      res.write(": ping\n\n");
    } catch {
      clients.delete(res);
    }
  }
}, 15_000);
heartbeat.unref();
