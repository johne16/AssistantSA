// Sidecar process supervisor. ap-server is the composition root, so it owns the
// lifecycle of the out-of-process sidecars (ap-voice, crawl-service): it spawns
// them on startup and tears them down when the host shuts down, so a single
// command brings the whole backend up and one signal takes it all down.

import { spawn, type ChildProcess } from "node:child_process";

export interface sidecar_spec {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface supervisor {
  start_all(): void;
  stop_all(): Promise<void>;
}

// Build a supervisor over the given sidecar specs. Output is inherited so each
// sidecar's logs stream straight to the host's stdio.
export function create_supervisor(specs: sidecar_spec[]): supervisor {
  const children: { name: string; child: ChildProcess }[] = [];
  let stopping = false;

  function start_all(): void {
    for (const spec of specs) {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: "inherit",
        // shell: resolve the command via PATH on both Windows and Linux.
        shell: true,
      });
      // A sidecar exiting on its own (not during shutdown) is a fault worth surfacing.
      child.on("exit", (code, signal) => {
        if (stopping) return;
        console.error(
          `[ap-server] sidecar ${spec.name} exited unexpectedly (code=${code} signal=${signal})`,
        );
      });
      child.on("error", (err) => {
        console.error(`[ap-server] sidecar ${spec.name} failed to start: ${err.message}`);
      });
      children.push({ name: spec.name, child });
      console.log(`[ap-server] started sidecar ${spec.name}: ${spec.command} ${spec.args.join(" ")}`);
    }
  }

  // SIGTERM every live child, then SIGKILL any that has not exited within 5s.
  async function stop_all(): Promise<void> {
    stopping = true;
    await Promise.all(
      children.map(
        ({ child }) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill("SIGTERM");
          }),
      ),
    );
  }

  return { start_all, stop_all };
}
