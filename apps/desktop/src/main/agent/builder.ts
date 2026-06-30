import { app, shell } from "electron";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import type { AgentTool, ToolContext } from "./tools";

/**
 * ACTIG Builder — autonomous full-stack "vibe coding" tools.
 *
 * The agent (NVIDIA Nemotron) plans a program, writes every file, builds/verifies it, optionally
 * publishes it to the GitHub account already signed in on this PC, and downloads the finished
 * product. All generated projects are sandboxed under `~/ACTIG/projects/<slug>/` — file writes
 * stay inside that tree (path-traversal is blocked), so the fast "write a whole project" path
 * needs no per-file confirmation, while running build commands and pushing to GitHub stay guarded.
 */

// ── project sandbox ──────────────────────────────────────────────────────
function projectsRoot(): string {
  const d = join(homedir(), "ACTIG", "projects");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

/** The project most recently created/used, so tools can default to it. */
let activeProject: string | null = null;

function projectDir(slug: string): string {
  return join(projectsRoot(), slug);
}

function resolveProject(arg?: string): { slug: string; dir: string } {
  const slug = arg ? slugify(arg) : activeProject;
  if (!slug) throw new Error("No active project — call create_project first.");
  const dir = projectDir(slug);
  if (!existsSync(dir)) throw new Error(`Project "${slug}" doesn't exist yet.`);
  return { slug, dir };
}

/** Join a relative path into a base dir, refusing anything that escapes the sandbox. */
function safeJoin(baseDir: string, rel: string): string {
  if (isAbsolute(rel)) throw new Error("Path must be relative to the project.");
  const full = resolve(baseDir, rel);
  const within = relative(baseDir, full);
  if (within.startsWith("..") || isAbsolute(within)) throw new Error("Path escapes the project folder.");
  return full;
}

// ── command runner (streams nothing to UI; returns output to the model) ──
interface RunResult {
  code: number;
  out: string;
}

function runIn(cwd: string, command: string, timeoutMs = 300000): Promise<RunResult> {
  return new Promise((res) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let out = "";
    const cap = (d: Buffer) => {
      out += d.toString();
      if (out.length > 12000) out = out.slice(-12000); // keep the tail (errors live there)
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => {
      child.kill();
      out += `\n[timed out after ${Math.round(timeoutMs / 1000)}s]`;
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      res({ code: code ?? 0, out: out.trim() || "(no output)" });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      res({ code: 1, out: `error: ${e.message}` });
    });
  });
}

// ── recursive copy with excludes (for packaging) ─────────────────────────
function copyDir(src: string, dst: string, exclude: (name: string) => boolean): void {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    if (exclude(name)) continue;
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d, exclude);
    else if (st.isFile()) copyFileSync(s, d);
  }
}

// ── tools ────────────────────────────────────────────────────────────────
export const BUILDER_TOOLS: AgentTool[] = [
  {
    spec: {
      name: "create_project",
      description:
        "Start a new software project. Creates a sandboxed folder and a plan file, and makes it the active project for the following build steps. Use this first when the user asks you to build/create a program or app.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human name of the project" },
          summary: { type: "string", description: "What the program should do" },
          stack: { type: "string", description: "Chosen tech stack (languages/frameworks)" },
        },
        required: ["name", "summary"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Create project "${a?.name}"`,
    async run(a) {
      const slug = slugify(a.name);
      const dir = projectDir(slug);
      mkdirSync(dir, { recursive: true });
      const plan = [
        `# ${a.name}`,
        "",
        a.summary || "",
        "",
        a.stack ? `**Stack:** ${a.stack}` : "",
        "",
        "_Generated and built by ACTIG._",
        "",
      ].join("\n");
      writeFileSync(join(dir, "ACTIG_PLAN.md"), plan, "utf8");
      activeProject = slug;
      return `Created project "${slug}" at ${dir}. It is now the active project.`;
    },
  },
  {
    spec: {
      name: "write_code_file",
      description:
        "Create or overwrite a file in the active project (or the named project). Use this for every source file, config, and text asset. Paths are relative to the project root.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, e.g. src/main.ts" },
          content: { type: "string" },
          project: { type: "string", description: "Project slug (defaults to active)" },
        },
        required: ["path", "content"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Write ${a?.path}`,
    async run(a) {
      const { dir } = resolveProject(a.project);
      const full = safeJoin(dir, a.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, String(a.content ?? ""), "utf8");
      return `Wrote ${a.path} (${Buffer.byteLength(String(a.content ?? ""))} bytes).`;
    },
  },
  {
    spec: {
      name: "generate_3d_model",
      description:
        "Write a 3D model asset file (e.g. OBJ, glTF/GLB-as-text, STL) into the project. Provide the full file content. For procedural/complex models, instead write a generator script with write_code_file and run it with run_build.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "e.g. assets/models/tree.obj" },
          content: { type: "string", description: "The full text of the model file" },
          project: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
    risk: "safe_write",
    describe: (a) => `Generate 3D model ${a?.path}`,
    async run(a) {
      const { dir } = resolveProject(a.project);
      const full = safeJoin(dir, a.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, String(a.content ?? ""), "utf8");
      return `Wrote 3D model ${a.path} (${Buffer.byteLength(String(a.content ?? ""))} bytes).`;
    },
  },
  {
    spec: {
      name: "read_code_file",
      description: "Read a file from the active/named project (to inspect or fix it).",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, project: { type: "string" } },
        required: ["path"],
      },
    },
    risk: "read",
    describe: (a) => `Read ${a?.path}`,
    async run(a) {
      const { dir } = resolveProject(a.project);
      return readFileSync(safeJoin(dir, a.path), "utf8").slice(0, 10000);
    },
  },
  {
    spec: {
      name: "list_project",
      description: "List the files in the active/named project (recursively).",
      input_schema: { type: "object", properties: { project: { type: "string" } } },
    },
    risk: "read",
    describe: () => "List project files",
    async run(a) {
      const { slug, dir } = resolveProject(a.project);
      const lines: string[] = [];
      const walk = (d: string, prefix: string) => {
        for (const name of readdirSync(d)) {
          if (name === "node_modules" || name === ".git") {
            lines.push(`${prefix}${name}/ …`);
            continue;
          }
          const s = join(d, name);
          if (statSync(s).isDirectory()) {
            lines.push(`${prefix}${name}/`);
            if (lines.length < 400) walk(s, prefix + "  ");
          } else lines.push(`${prefix}${name}`);
        }
      };
      walk(dir, "");
      return `${slug}/\n` + lines.slice(0, 400).join("\n");
    },
  },
  {
    spec: {
      name: "run_build",
      description:
        "Run a shell command inside the active/named project — scaffolders, dependency installs, builds, tests, or the project's generator scripts (e.g. 'npm install', 'npm run build', 'python gen.py'). Returns the command output so you can fix errors and re-run.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          project: { type: "string" },
        },
        required: ["command"],
      },
    },
    risk: "system",
    describe: (a) => `Run in project: ${a?.command}`,
    async run(a) {
      const { dir } = resolveProject(a.project);
      const { code, out } = await runIn(dir, String(a.command));
      return `exit ${code}\n${out}`;
    },
  },
  {
    spec: {
      name: "github_status",
      description:
        "Check whether a GitHub account is available on this PC (via the gh CLI or git config). Use before publishing.",
      input_schema: { type: "object", properties: {} },
    },
    risk: "read",
    describe: () => "Check GitHub login",
    async run() {
      const gh = await runIn(homedir(), "gh auth status", 15000);
      if (gh.code === 0) return `gh CLI is logged in:\n${gh.out}`;
      const name = await runIn(homedir(), "git config --get user.name", 8000);
      const email = await runIn(homedir(), "git config --get user.email", 8000);
      if (name.code === 0 && name.out && name.out !== "(no output)")
        return `No gh CLI login, but git is configured as ${name.out} <${email.out}>. Publishing will need the gh CLI ('gh auth login') or a pre-created remote.`;
      return "No GitHub login found. Install the GitHub CLI and run 'gh auth login' once, then I can publish.";
    },
  },
  {
    spec: {
      name: "github_publish",
      description:
        "Create a GitHub repository for the active/named project and push it, using the account already signed in on this PC (gh CLI). Only do this when the user asks to publish/push.",
      input_schema: {
        type: "object",
        properties: {
          repoName: { type: "string" },
          private: { type: "boolean", description: "default true" },
          project: { type: "string" },
        },
        required: ["repoName"],
      },
    },
    risk: "sensitive",
    describe: (a) => `Publish to GitHub as ${a?.private === false ? "public" : "private"} repo "${a?.repoName}"`,
    async run(a) {
      const { dir } = resolveProject(a.project);
      const ghCheck = await runIn(dir, "gh --version", 10000);
      if (ghCheck.code !== 0)
        return "The GitHub CLI (gh) isn't installed. Install it from cli.github.com and run 'gh auth login', then ask me to publish again.";
      // Ensure a git repo + a commit exist.
      if (!existsSync(join(dir, ".git"))) {
        await runIn(dir, "git init");
        await runIn(dir, 'git config user.name "ACTIG"');
        await runIn(dir, 'git config user.email "actig@local"');
      }
      await runIn(dir, "git add -A");
      await runIn(dir, 'git commit -m "Build by ACTIG" --allow-empty');
      const vis = a.private === false ? "--public" : "--private";
      const created = await runIn(
        dir,
        `gh repo create ${slugify(a.repoName)} ${vis} --source=. --remote=origin --push`,
        120000,
      );
      if (created.code !== 0) return `Publish failed:\n${created.out}`;
      const url = await runIn(dir, "gh repo view --json url -q .url", 15000);
      return `Published to GitHub: ${url.out || created.out}`;
    },
  },
  {
    spec: {
      name: "download_result",
      description:
        "Package the finished project as a .zip in the user's Downloads folder and reveal it. Use as the final delivery step after the project builds.",
      input_schema: {
        type: "object",
        properties: {
          project: { type: "string" },
          includeBuild: { type: "boolean", description: "include build output like dist/ (default true)" },
        },
      },
    },
    risk: "safe_write",
    describe: () => "Package the project to Downloads",
    async run(a) {
      const { slug, dir } = resolveProject(a.project);
      const includeBuild = a.includeBuild !== false;
      const skip = new Set(["node_modules", ".git", ".cache"]);
      if (!includeBuild) ["dist", "build", "out", ".next"].forEach((d) => skip.add(d));
      const stageParent = join(tmpdir(), `actig-zip-${slug}-${Date.now()}`);
      const stage = join(stageParent, slug);
      copyDir(dir, stage, (name) => skip.has(name));

      const downloads = app.getPath("downloads");
      const dest = join(downloads, `${slug}.zip`);
      try {
        if (existsSync(dest)) rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }

      let zipped: RunResult;
      if (process.platform === "win32") {
        zipped = await runIn(
          stageParent,
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '${slug}' -DestinationPath '${dest}' -Force"`,
          120000,
        );
      } else {
        zipped = await runIn(stageParent, `zip -rq "${dest}" "${slug}" || tar -czf "${dest}" "${slug}"`, 120000);
      }
      try {
        rmSync(stageParent, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (!existsSync(dest)) return `Could not create the zip:\n${zipped.out}`;
      shell.showItemInFolder(dest);
      return `Downloaded the finished project to ${dest}.`;
    },
  },
];
