import { spawn, ChildProcess } from "node:child_process";
import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Owns the Python agent-core process and keeps it alive (requirement 3: always active in
 * background). In a packaged build the backend is a frozen exe bundled alongside the app;
 * in dev we run `python -m actig.server`. A watchdog restarts it with backoff if it exits.
 */
export class BackendProcess {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts = 0;

  constructor(
    private readonly host = "127.0.0.1",
    private readonly port = 8765,
  ) {}

  get url(): string {
    return `ws://${this.host}:${this.port}/ws`;
  }

  start(): void {
    this.stopping = false;
    this.spawnOnce();
  }

  private resolveCommand(): { cmd: string; args: string[] } {
    // Packaged: <resources>/backend/actig-core(.exe). Dev: python module.
    const frozen = join(
      process.resourcesPath || app.getAppPath(),
      "backend",
      process.platform === "win32" ? "actig-core.exe" : "actig-core",
    );
    if (existsSync(frozen)) return { cmd: frozen, args: [] };
    const py = process.platform === "win32" ? "python" : "python3";
    return { cmd: py, args: ["-m", "actig.server"] };
  }

  private spawnOnce(): void {
    const { cmd, args } = this.resolveCommand();
    this.child = spawn(cmd, args, {
      env: { ...process.env, ACTIG_HOST: this.host, ACTIG_PORT: String(this.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child.stdout?.on("data", (d) => console.log(`[core] ${d}`.trim()));
    this.child.stderr?.on("data", (d) => console.error(`[core] ${d}`.trim()));
    this.child.on("exit", (code) => {
      if (this.stopping) return;
      const delay = Math.min(16000, 1000 * 2 ** this.restarts++);
      console.warn(`[core] exited (${code}); restarting in ${delay}ms`);
      setTimeout(() => this.spawnOnce(), delay);
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }
}
