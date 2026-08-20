import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";

import { createContext } from "./context.js";
import { createRouter } from "./routes/index.js";
import { logger } from "./lib/logger.js";

/**
 * Builds the Express application.
 *
 * Async because the context resolves external dependencies — the store, 0G Storage
 * and 0G Chain — before the first request is served. Discovering at request time
 * that the chain is unreachable would turn a configuration problem into an
 * intermittent one.
 */
export async function createApp(): Promise<Express> {
  const ctx = await createContext();
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(cors());
  // Evidence bundles are CSV documents sent as JSON; the default 100kb limit
  // rejects a realistic 756 x 60 trials matrix.
  app.use(express.json({ limit: "64mb" }));
  app.use(express.urlencoded({ extended: true, limit: "64mb" }));

  app.use("/api", createRouter(ctx));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log?.error({ err: error }, "unhandled request error");
    res.status(500).json({ error: error.message || "internal server error" });
  });

  return app;
}
