import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./net.js";

const here = dirname(fileURLToPath(import.meta.url));

function readEnv(): { dataDir: string; port: number; production: boolean; clientDist?: string } {
  const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), "data"));
  const port = Number(process.env.PORT ?? 3_000);
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const production = nodeEnv === "production" || process.env.PRODUCTION === "1";
  const clientDistEnv = process.env.CLIENT_DIST;
  const clientDist = clientDistEnv
    ? resolve(clientDistEnv)
    : production
      ? join(here, "..", "..", "client", "dist")
      : undefined;
  return { dataDir, port, production, ...(clientDist ? { clientDist } : {}) };
}

async function main(): Promise<void> {
  const opts = readEnv();
  const { server, close } = await startServer(opts);
  server.listen(opts.port, () => {
    console.log(`[splash] listening on :${opts.port} (data=${opts.dataDir}, prod=${opts.production})`);
  });
  const shutdown = (signal: string): void => {
    console.log(`[splash] received ${signal}, shutting down`);
    close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[splash] fatal", err);
  process.exit(1);
});
