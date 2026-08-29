import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

/* One battery per checkout may run while another checkout's battery runs
   beside it (parallel worktrees). A fixed port made those runs race: the
   second suite attached to the first checkout's server — testing a foreign
   dist/ — and lost it mid-run when that battery tore down. The port is
   derived from this config's own path, so every checkout gets a stable
   port of its own, and a server is never reused: this suite must prove
   THIS tree. */
const digest = createHash("sha256").update(import.meta.dirname).digest();
/* Chromium refuses its restricted ports (ERR_UNSAFE_PORT); skip the ones
   inside the derived range or a checkout path can hash to a dead suite. */
const UNSAFE_PORTS = new Set([4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697]);
let port = 4400 + (digest.readUInt16BE(0) % 4000);
while (UNSAFE_PORTS.has(port)) port += 1;

export default defineConfig({
  testDir: "./test",
  // Every test owns its page and navigates fresh; nothing shares state
  // through a file, so file-order serialization buys nothing.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    colorScheme: "light",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: {
    // Keep preview in the foreground so Playwright owns teardown.
    command: `ASTRO_PREVIEW_BACKGROUND=0 pnpm exec astro preview --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
