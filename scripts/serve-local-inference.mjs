import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, ".tmp/local-inference");
const executable = resolve(directory, "ollama-v0.33.3/ollama.exe");
if (process.platform !== "win32")
  throw new Error(
    "This workspace runtime launcher is Windows-only. See docs/agent/INFERENCE.md for other systems.",
  );
try {
  await access(executable);
} catch {
  throw new Error(
    "Workspace Ollama is not installed. Follow docs/agent/INFERENCE.md; this command never downloads a model automatically.",
  );
}
await mkdir(resolve(directory, "models"), { recursive: true });
const child = spawn(executable, ["serve"], {
  cwd: root,
  windowsHide: true,
  stdio: "inherit",
  env: {
    ...process.env,
    OLLAMA_HOST: "127.0.0.1:11434",
    OLLAMA_MODELS: resolve(directory, "models"),
    OLLAMA_NO_CLOUD: "1",
    OLLAMA_NUM_PARALLEL: "1",
    OLLAMA_MAX_LOADED_MODELS: "1",
    OLLAMA_CONTEXT_LENGTH: "8192",
    OLLAMA_ORIGINS: "http://127.0.0.1:11434",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Could not start the workspace-local runtime.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
