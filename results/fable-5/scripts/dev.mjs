// Dev orchestrator: builds shared once, then runs server (tsx watch, :3000)
// and client (vite, :5173) side by side. Ctrl-C kills both.
import { spawn, spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;

console.log("[dev] building @splash/shared...");
const build = spawnSync("npm", ["run", "build", "-w", "@splash/shared"], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const procs = [
  spawn("npm", ["run", "dev", "-w", "@splash/server"], { cwd: root, stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@splash/client"], { cwd: root, stdio: "inherit" }),
];

const killAll = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);
for (const p of procs) p.on("exit", (code) => {
  if (code !== null && code !== 0) killAll();
});
