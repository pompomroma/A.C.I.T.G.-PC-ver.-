import { shell } from "electron";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, platform, release, totalmem, freemem, userInfo } from "node:os";
import { join, resolve } from "node:path";
import type { ToolSpec } from "./claude";

/**
 * Node implementations of ACTIG's guarded tools (requirements 13, 14, 18, 19). Each tool
 * declares a `risk`; `sensitive`/`system` tools must be confirmed by the user (the loop calls
 * `ctx.confirm` before `run`). UI-control tools call the real window functions in the main
 * process so "open the 3D project", "set the 3D wallpaper", etc. work by voice or text.
 */

export type RiskLevel = "read" | "safe_write" | "sensitive" | "system";

/** Window/UI control surface the agent can drive — provided by main/index.ts. */
export interface AgentHost {
  wake(source: "voice" | "emergency" | "hotkey" | "text"): void;
  openProject3D(): void;
  closeProject3D(): void;
  toggleWallpaper(enabled: boolean): Promise<void> | void;
  /** Broadcast a core→ui envelope to every hologram surface. */
  broadcast(msg: { type: string; payload: unknown }): void;
}

export interface ToolContext {
  host: AgentHost;
  /** Ask the user to approve a sensitive/system action; resolves true if approved. */
  confirm(tool: string, description: string, risk: RiskLevel): Promise<boolean>;
}

export interface AgentTool {
  spec: ToolSpec;
  risk: RiskLevel;
  /** Human one-liner shown in the confirmation dialog / audit. */
  describe(args: any): string;
  run(args: any, ctx: ToolContext): Promise<string>;
}

const MUSIC_SEARCH = "https://music.youtube.com/search?q=";
const notesDir = () => {
  const d = join(homedir(), "ACTIG", "notes");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};

function run(cmd: string): Promise<string> {
  return new Promise((res) => {
    exec(cmd, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) res(`error: ${stderr || err.message}`);
      else res((stdout || "ok").toString().slice(0, 4000));
    });
  });
}

export const TOOLS: AgentTool[] = [
  // ── UI / 3D / wallpaper control (req 4, 5, 16, 17) ──────────────────────
  {
    spec: {
      name: "open_3d_project",
      description:
        "Open the Iron-Man-style 3D modeling project space window. Use whenever the user asks to bring up, open, or show the 3D project/space.",
      input_schema: { type: "object", properties: {} },
    },
    risk: "safe_write",
    describe: () => "Open the 3D project space",
    async run(_a, ctx) {
      ctx.host.openProject3D();
      return "The 3D project space is now open.";
    },
  },
  {
    spec: {
      name: "close_3d_project",
      description: "Close/hide the 3D project space window.",
      input_schema: { type: "object", properties: {} },
    },
    risk: "safe_write",
    describe: () => "Close the 3D project space",
    async run(_a, ctx) {
      ctx.host.closeProject3D();
      return "Closed the 3D project space.";
    },
  },
  {
    spec: {
      name: "add_3d_shape",
      description:
        "Add a primitive shape to the 3D project space. Opens the space first if needed.",
      input_schema: {
        type: "object",
        properties: {
          shape: {
            type: "string",
            enum: ["cube", "sphere", "cylinder", "cone", "torus", "plane", "tetrahedron", "icosahedron"],
          },
        },
        required: ["shape"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Add a ${a?.shape || "shape"} to the 3D space`,
    async run(a, ctx) {
      ctx.host.openProject3D();
      ctx.host.broadcast({ type: "project3d", payload: { command: { action: "add", shape: a.shape } } });
      return `Added a ${a.shape} to the 3D space.`;
    },
  },
  {
    spec: {
      name: "set_wallpaper",
      description:
        "Turn the live 3D scene on or off as the desktop wallpaper (replaces/restores the background).",
      input_schema: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
      },
    },
    risk: "system",
    describe: (a) => (a?.enabled ? "Set the 3D space as your wallpaper" : "Restore your normal wallpaper"),
    async run(a, ctx) {
      await ctx.host.toggleWallpaper(!!a.enabled);
      return a.enabled ? "The 3D space is now your live wallpaper." : "Restored your normal wallpaper.";
    },
  },
  {
    spec: {
      name: "toggle_camera",
      description: "Enable or disable webcam hand-tracking gestures in the 3D project space.",
      input_schema: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Turn the gesture camera ${a?.enabled ? "on" : "off"}`,
    async run(a, ctx) {
      ctx.host.openProject3D();
      ctx.host.broadcast({ type: "camera_gesture", payload: { enabled: !!a.enabled } });
      return `Gesture camera ${a.enabled ? "enabled" : "disabled"}.`;
    },
  },

  // ── web / music / apps (req 18, 19) ─────────────────────────────────────
  {
    spec: {
      name: "play_music",
      description:
        "Play music the user requests by opening it on the web (YouTube Music). Pass the song/artist as the query.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Play "${a?.query}" on the web`,
    async run(a) {
      await shell.openExternal(MUSIC_SEARCH + encodeURIComponent(a.query));
      return `Opening "${a.query}" on YouTube Music.`;
    },
  },
  {
    spec: {
      name: "open_url",
      description: "Open a web page or URL in the default browser.",
      input_schema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Open ${a?.url}`,
    async run(a) {
      const url = /^https?:\/\//i.test(a.url) ? a.url : `https://${a.url}`;
      await shell.openExternal(url);
      return `Opened ${url} in your browser.`;
    },
  },
  {
    spec: {
      name: "open_app",
      description:
        "Launch an installed application by name (e.g. 'notepad', 'calc', 'chrome'). Windows only.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    risk: "system",
    describe: (a) => `Launch the app "${a?.name}"`,
    async run(a) {
      if (platform() === "win32") return run(`start "" "${String(a.name).replace(/"/g, "")}"`);
      return run(String(a.name));
    },
  },
  {
    spec: {
      name: "open_settings",
      description:
        "Open a Windows Settings page via an ms-settings: URI (e.g. 'display', 'bluetooth', 'network', 'sound').",
      input_schema: {
        type: "object",
        properties: { page: { type: "string" } },
        required: ["page"],
      },
    },
    risk: "system",
    describe: (a) => `Open Windows Settings: ${a?.page}`,
    async run(a) {
      const page = String(a.page).replace(/[^a-z0-9-]/gi, "");
      await shell.openExternal(`ms-settings:${page}`);
      return `Opened Settings → ${page}.`;
    },
  },

  // ── files (req 19) ──────────────────────────────────────────────────────
  {
    spec: {
      name: "list_files",
      description: "List files in a folder. Defaults to the user's home folder.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
    risk: "read",
    describe: (a) => `List files in ${a?.path || "home"}`,
    async run(a) {
      const dir = a?.path ? resolve(a.path) : homedir();
      const entries = readdirSync(dir).slice(0, 200).map((name) => {
        try {
          return statSync(join(dir, name)).isDirectory() ? `${name}/` : name;
        } catch {
          return name;
        }
      });
      return `${dir}:\n` + entries.join("\n");
    },
  },
  {
    spec: {
      name: "read_file",
      description: "Read a text file's contents (first ~8000 chars).",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    risk: "read",
    describe: (a) => `Read ${a?.path}`,
    async run(a) {
      const p = resolve(a.path);
      return readFileSync(p, "utf8").slice(0, 8000);
    },
  },
  {
    spec: {
      name: "write_note",
      description:
        "Save a text note/file under the user's ACTIG/notes folder. Use for jotting things down or saving generated text.",
      input_schema: {
        type: "object",
        properties: { filename: { type: "string" }, content: { type: "string" } },
        required: ["filename", "content"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Save note "${a?.filename}"`,
    async run(a) {
      const name = String(a.filename).replace(/[\\/:*?"<>|]/g, "_");
      const p = join(notesDir(), name);
      writeFileSync(p, String(a.content ?? ""), "utf8");
      return `Saved note to ${p}.`;
    },
  },
  {
    spec: {
      name: "create_file",
      description: "Create or overwrite a file at an arbitrary path with the given text content.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    risk: "sensitive",
    describe: (a) => `Write file ${a?.path}`,
    async run(a) {
      const p = resolve(a.path);
      writeFileSync(p, String(a.content ?? ""), "utf8");
      return `Wrote ${p}.`;
    },
  },

  // ── system info + raw command (req 19) ──────────────────────────────────
  {
    spec: {
      name: "system_info",
      description: "Report basic PC info: OS, hostname, user, CPU/memory.",
      input_schema: { type: "object", properties: {} },
    },
    risk: "read",
    describe: () => "Read system info",
    async run() {
      const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
      return [
        `user: ${userInfo().username}`,
        `host: ${hostname()}`,
        `os: ${platform()} ${release()}`,
        `memory: ${gb(totalmem() - freemem())} / ${gb(totalmem())} GB used`,
      ].join("\n");
    },
  },
  {
    spec: {
      name: "run_command",
      description:
        "Run a shell command on the PC and return its output. Use only when no safer tool fits; this is powerful and guarded.",
      input_schema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
    risk: "system",
    describe: (a) => `Run command: ${a?.command}`,
    async run(a) {
      return run(String(a.command));
    },
  },
];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.spec.name, t]));
