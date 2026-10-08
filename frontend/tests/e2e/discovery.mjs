import { spawnSync } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUITES } from "./selection.mjs";

export function requireSupportedNode(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) !== 24 || Number(match[2]) < 19)
    throw new Error(
      `Local E2E requires Node >=24.19.0 <25; running ${version}. Switch Node versions, then run npm ci --prefix backend --include=dev and npm ci --prefix frontend --include=dev from the repository root.`,
    );
}

export async function requireDependencies(folder, name) {
  try {
    if (!(await stat(path.join(folder, "node_modules"))).isDirectory())
      throw new Error("Not a dependency directory");
  } catch {
    throw new Error(
      `Cannot access ${name}/node_modules. From the repository root run npm ci --prefix ${name} --include=dev.`,
    );
  }
}

export async function discoverCases(
  suite,
  {
    frontend,
    env,
    diagnostics,
    executable = process.execPath,
    timeout = 20_000,
  },
) {
  if (!SUITES.includes(suite)) throw new Error("Unknown scenario suite");
  const result = spawnSync(
    executable,
    [`tests/e2e/${suite}.browser.mjs`, "--list-cases"],
    {
      cwd: frontend,
      env,
      encoding: "utf8",
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
    },
  );
  let cases;
  if (result.status === 0) {
    try {
      cases = JSON.parse(result.stdout);
      if (
        !Array.isArray(cases) ||
        cases.some((entry) => entry?.suite !== suite)
      )
        cases = undefined;
    } catch {
      // Preserve malformed output privately; it may contain arbitrary text.
    }
    if (cases) return cases;
  }
  const code = String(result.error?.code ?? "");
  const details = [
    `Node ${process.versions.node}, ${process.platform}/${process.arch}`,
    `exit=${result.status ?? "none"}`,
    `signal=${result.signal ?? "none"}`,
  ];
  if (/^[A-Z][A-Z0-9_]{0,39}$/.test(code)) details.push(`spawn=${code}`);
  const stderr = result.stderr ?? "";
  let reason = "inspect the private discovery logs";
  if (code === "ETIMEDOUT") reason = `discovery timed out after ${timeout}ms`;
  else if (code === "ENOBUFS") reason = "discovery exceeded its output limit";
  else if (stderr.includes("Cannot find package 'playwright'"))
    reason =
      "Playwright dependency is missing; run npm ci --prefix frontend --include=dev from the repository root";
  else if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(stderr))
    reason = "a discovery module could not be loaded";
  else if (result.status === 0)
    reason = "discovery returned invalid scenario JSON";
  await writeFile(
    path.join(diagnostics, `discovery-${suite}.stdout.log`),
    result.stdout ?? "",
    { mode: 0o600 },
  );
  await writeFile(
    path.join(diagnostics, `discovery-${suite}.stderr.log`),
    stderr,
    { mode: 0o600 },
  );
  await writeFile(
    path.join(diagnostics, `discovery-${suite}.json`),
    JSON.stringify(
      {
        suite,
        node: process.versions.node,
        executable,
        cwd: frontend,
        platform: process.platform,
        arch: process.arch,
        status: result.status,
        signal: result.signal,
        code,
        timeout,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw new Error(
    `Scenario discovery failed for ${suite} (${details.join("; ")}): ${reason}. No browser scenarios have run. Read-only comparison from the repository root: node frontend/tests/e2e/${suite}.browser.mjs --list-cases`,
  );
}
