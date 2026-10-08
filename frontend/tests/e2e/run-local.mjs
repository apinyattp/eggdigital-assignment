import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../../", import.meta.url));
const backend = fileURLToPath(new URL("../../../backend/", import.meta.url));
const image =
  "postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c";
const runId = randomUUID();
const containerName = "eggdigital-e2e-" + runId;
const children = new Set();
const platformEnv = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "TMPDIR",
    "DOCKER_CONFIG",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PLAYWRIGHT_EXECUTABLE_PATH",
    "CI",
    "E2E_HEADED",
    "E2E_TRACE",
    "E2E_CASE",
    "PWDEBUG",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
let env,
  temporary,
  evidence,
  manifest,
  rejectActive,
  created = false,
  interrupted = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, extra = {}, timeout = 180_000) {
  const result = spawnSync("docker", args, {
    env: { ...platformEnv, ...extra },
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
  });
  if (result.status !== 0)
    throw new Error("Owned local E2E Docker operation failed");
  return result.stdout.trim();
}
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function start(command, args, cwd, name, childEnv = env) {
  if (interrupted) throw new Error("E2E run interrupted");
  const log = createWriteStream(path.join(temporary, name + ".log"), {
    mode: 0o600,
  });
  const child = spawn(command, args, {
    cwd,
    env: childEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once("exit", () => children.delete(child));
  child.once("close", () => log.end());
  return child;
}
async function completion(child, label, timeoutMs = 10 * 60_000) {
  let timer;
  try {
    const code = await new Promise((resolve, reject) => {
      rejectActive = reject;
      timer = setTimeout(() => {
        signal(child, "SIGTERM");
        reject(
          Object.assign(new Error(label + " exceeded its bounded runtime"), {
            code: "E2E_TIMEOUT",
          }),
        );
      }, timeoutMs);
      if (child.exitCode !== null) resolve(child.exitCode);
      else {
        child.once("error", reject);
        child.once("exit", resolve);
      }
    });
    if (code !== 0 || interrupted)
      throw new Error(label + " failed; see private local run logs");
  } finally {
    clearTimeout(timer);
    rejectActive = undefined;
  }
}
async function ready(origin, child, route) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && child.exitCode === null && !interrupted) {
    try {
      if (
        (await fetch(origin + route, { signal: AbortSignal.timeout(1500) })).ok
      )
        return;
    } catch {
      /* Startup only. */
    }
    await pause(250);
  }
  throw new Error("Owned local server did not become ready");
}
function signal(child, value) {
  try {
    process.kill(-child.pid, value);
  } catch {
    /* Already exited. */
  }
}
for (const name of ["SIGINT", "SIGTERM"])
  process.on(name, () => {
    interrupted = true;
    rejectActive?.(new Error("E2E run interrupted"));
    for (const child of children) signal(child, "SIGTERM");
  });

// Leave CI enough time to stop child groups and remove the owned database.
const runDeadline = setTimeout(() => {
  interrupted = true;
  rejectActive?.(new Error("E2E run exceeded its 28-minute runtime limit"));
  for (const child of children) signal(child, "SIGTERM");
  process.stderr.write("E2E run exceeded its 28-minute runtime limit\n");
}, 28 * 60_000);
runDeadline.unref();

function makeFixture(origin, password) {
  const reference = Date.now();
  const referenceTime = new Date(reference).toISOString();
  const date = new Date(reference + 2 * 86400000).toISOString().slice(0, 10);
  const pastDate = new Date(reference - 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const accounts = Object.fromEntries(
    [
      "owner",
      "attendee",
      "outsider",
      "candidate",
      "googleOnly",
      "revocable",
    ].map((role, index) => [
      role,
      {
        id: "10000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
        email: `e2e-${role.toLowerCase()}@example.test`,
        displayName: `E2E ${role}`,
        password,
      },
    ]),
  );
  const meeting = (index, title, options = {}) => ({
    id: "20000000-0000-4000-8000-" + String(index).padStart(12, "0"),
    creatorId: accounts.owner.id,
    title,
    candidateName: `E2E Candidate ${index}`,
    candidateEmail: `e2e-candidate-${index}@example.test`,
    startsAt: date + "T03:00:00.000Z",
    endsAt: date + "T04:00:00.000Z",
    status: "PENDING",
    format: "ONSITE",
    ...options,
  });
  const meetings = {
    onsite: meeting(1, "E2E Onsite interview"),
    online: meeting(2, "E2E Online interview", { format: "ONLINE" }),
    past: meeting(3, "E2E Completed interview", {
      startsAt: pastDate + "T03:00:00.000Z",
      endsAt: pastDate + "T04:00:00.000Z",
    }),
    rejected: meeting(4, "E2E Rejected interview", { status: "REJECTED" }),
    cancelled: meeting(5, "E2E Cancelled interview", { status: "CANCELLED" }),
    private: meeting(6, "E2E Private outsider interview", {
      creatorId: accounts.outsider.id,
      candidateEmail: accounts.candidate.email,
    }),
  };
  const extra = Array.from({ length: 10 }, (_, index) =>
    meeting(
      10 + index,
      `E2E Page interview ${String(index + 1).padStart(2, "0")}`,
    ),
  );
  return {
    runId,
    origin,
    password,
    referenceTime,
    date,
    pastDate,
    accounts,
    meetings,
    feedbackMeetingId: meetings.past.id,
    listMeetingIds: [
      meetings.onsite.id,
      meetings.online.id,
      ...extra.map((row) => row.id),
    ],
    seedMeetings: [...Object.values(meetings), ...extra],
  };
}

try {
  const knownSuites = ["auth", "meetings", "authorization"];
  const requestedSuite = process.env.E2E_SUITE;
  const requestedCase = process.env.E2E_CASE;
  if (requestedSuite !== undefined && !knownSuites.includes(requestedSuite))
    throw new Error("E2E_SUITE must be auth, meetings, or authorization");
  if (
    requestedCase !== undefined &&
    (!requestedSuite || !/^E2E-[A-Za-z0-9_-]+$/.test(requestedCase))
  )
    throw new Error(
      "E2E_CASE must be an exact scenario ID and requires E2E_SUITE",
    );
  const suites = (requestedSuite ? [requestedSuite] : knownSuites).map(
    (name) => name + ".browser.mjs",
  );
  for (const folder of [frontend, backend]) {
    await access(path.join(folder, "node_modules"));
    if (
      (await readdir(folder)).some(
        (name) => name.startsWith(".env") && name !== ".env.example",
      )
    )
      throw new Error(
        "Use a clean checkout without app .env files; the E2E runner supplies isolated configuration",
      );
  }
  const browsers = (process.env.E2E_BROWSERS ?? "chromium").split(",");
  if (
    !browsers.length ||
    browsers.some((value) => !["chromium", "webkit"].includes(value))
  )
    throw new Error(
      "E2E_BROWSERS must be chromium, webkit, or chromium,webkit",
    );
  temporary = await mkdtemp(path.join(tmpdir(), "eggdigital-e2e-"));
  await chmod(temporary, 0o700);
  evidence = path.resolve(
    process.env.E2E_EVIDENCE_DIR ?? path.join(frontend, "e2e-results", runId),
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const git = (args) =>
    spawnSync("git", args, {
      cwd: frontend,
      env: platformEnv,
      encoding: "utf8",
      timeout: 5000,
    });
  const head = git(["rev-parse", "HEAD"]);
  const state = git(["status", "--porcelain"]);
  manifest = {
    head:
      head.status === 0 && /^[0-9a-f]{40}$/.test(head.stdout.trim())
        ? head.stdout.trim()
        : null,
    dirty: state.status === 0 ? Boolean(state.stdout.trim()) : null,
    browsers,
    suite: requestedSuite ?? null,
    case: requestedCase ?? null,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  await writeFile(
    path.join(evidence, "run.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  const frontendPort = await port();
  let backendPort = await port();
  while (backendPort === frontendPort) backendPort = await port();
  const origin = `http://localhost:${frontendPort}`;
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const password = randomBytes(24).toString("base64url");
  const databasePassword = randomBytes(24).toString("hex");
  const dockerHost = JSON.parse(
    docker([
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
  );
  if (
    typeof dockerHost !== "string" ||
    !/^(?:unix|npipe):\/\//.test(dockerHost)
  )
    throw new Error(
      "E2E requires a local Docker socket; remote Docker contexts are refused",
    );
  process.stdout.write("Creating an owned local PostgreSQL test container…\n");
  // A timed-out create may still have succeeded; reconcile only this owned name in finally.
  created = true;
  docker(
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--label",
      "eggdigital.e2e.run=" + runId,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_USER=meeting_manager",
      "--env",
      "POSTGRES_DB=meeting_manager_test",
      image,
    ],
    { POSTGRES_PASSWORD: databasePassword },
  );
  let databaseReady = false;
  for (let attempt = 0; attempt < 90 && !interrupted; attempt++) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        containerName,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "meeting_manager",
        "-d",
        "meeting_manager_test",
      ],
      {
        env: platformEnv,
        stdio: "ignore",
        timeout: 5000,
        killSignal: "SIGKILL",
      },
    );
    if (result.status === 0) {
      databaseReady = true;
      break;
    }
    await pause(500);
  }
  if (!databaseReady)
    throw new Error("Owned E2E PostgreSQL did not become ready");
  const databasePort = docker(["port", containerName, "5432/tcp"])
    .split(":")
    .pop();
  if (!/^\d+$/.test(databasePort ?? ""))
    throw new Error("Invalid owned database port");
  const databaseUrl = `postgresql://meeting_manager:${databasePassword}@127.0.0.1:${databasePort}/meeting_manager_test`;
  env = {
    ...platformEnv,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_API_BASE_URL: "/api/v1",
    API_PROXY_ORIGIN: backendOrigin,
    AUTH_BACKEND_INTERNAL_URL: backendOrigin,
    NEXTAUTH_URL: origin,
    NEXTAUTH_SECRET: randomBytes(32).toString("base64url"),
    AUTH_SERVICE_KEY: randomBytes(32).toString("base64url"),
    JWT_SIGNING_KEY_BASE64: randomBytes(32).toString("base64"),
    JWT_ACCESS_TTL_SECONDS: "900",
    COOKIE_SECURE: "false",
    ALLOWED_ORIGIN: origin,
    DATABASE_URL: databaseUrl,
    PORT: String(backendPort),
    E2E_DATABASE_URL: databaseUrl,
    E2E_RUN_ID: runId,
    E2E_RUN_TOKEN: randomBytes(32).toString("base64url"),
    E2E_OWNED_CONTAINER: containerName,
    E2E_FIXTURE_PATH: path.join(temporary, "fixture.json"),
    E2E_EVIDENCE_DIR: evidence,
    FE_TEST_ORIGIN: origin,
  };
  await writeFile(
    env.E2E_FIXTURE_PATH,
    JSON.stringify(makeFixture(origin, password)),
    { mode: 0o600 },
  );
  await completion(
    start(
      process.execPath,
      ["--import", "tsx", "scripts/e2e-fixture.ts", "init"],
      backend,
      "fixture-init",
    ),
    "Fixture initialization",
    2 * 60_000,
  );
  process.stdout.write("Building the real backend and production frontend…\n");
  await completion(
    start("npm", ["run", "build"], backend, "backend-build"),
    "Backend build",
    2 * 60_000,
  );
  await completion(
    start("npm", ["run", "build"], frontend, "frontend-build"),
    "Frontend build",
    8 * 60_000,
  );
  const be = start(process.execPath, ["dist/server.js"], backend, "backend");
  await ready(backendOrigin, be, "/api/v1/health/ready");
  const fe = start(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "localhost",
      "--port",
      String(frontendPort),
    ],
    frontend,
    "frontend",
  );
  await ready(origin, fe, "/login");
  const failedSuites = [];
  for (const browser of browsers)
    for (const suite of suites) {
      if (interrupted) throw new Error("E2E run interrupted");
      await access(path.join(frontend, "tests/e2e", suite));
      process.stdout.write(`Running ${suite} on ${browser} (serial)…\n`);
      const child = start(
        process.execPath,
        ["tests/e2e/" + suite],
        frontend,
        browser + "-" + suite,
        { ...env, PLAYWRIGHT_BROWSER: browser },
      );
      try {
        await completion(child, `${browser} ${suite}`);
      } catch (error) {
        // Collect completed suite failures, but never overlap a timed-out or live process.
        if (
          interrupted ||
          error.code === "E2E_TIMEOUT" ||
          (child.exitCode === null && child.signalCode === null)
        )
          throw error;
        failedSuites.push(`${browser} ${suite}`);
        process.stdout.write(
          `FAILED ${browser} ${suite}; collecting remaining suites\n`,
        );
      }
      // Only the helper's already-redacted report is public; private child logs stay local.
      try {
        const report = JSON.parse(
          await readFile(
            path.join(
              evidence,
              browser,
              suite.replace(".browser.mjs", ""),
              "results.json",
            ),
            "utf8",
          ),
        );
        for (const result of report.results)
          process.stdout.write(JSON.stringify(result) + "\n");
        if (report.initializationError)
          process.stdout.write(
            JSON.stringify(report.initializationError) + "\n",
          );
      } catch {
        process.stdout.write(
          `No safe scenario report was produced for ${browser} ${suite}\n`,
        );
      }
    }
  if (failedSuites.length) {
    manifest.failedSuites = failedSuites;
    throw new Error("E2E suites failed: " + failedSuites.join(", "));
  }
  process.stdout.write(`Local real-stack E2E passed. Evidence: ${evidence}\n`);
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : "Local E2E failed") + "\n",
  );
  if (temporary)
    process.stderr.write(`Private local diagnostics: ${temporary}\n`);
  process.exitCode = 1;
} finally {
  clearTimeout(runDeadline);
  const active = [...children];
  for (const child of active) signal(child, "SIGTERM");
  const deadline = Date.now() + 12_000;
  while (
    active.some(
      (child) => child.exitCode === null && child.signalCode === null,
    ) &&
    Date.now() < deadline
  )
    await pause(100);
  for (const child of active)
    if (child.exitCode === null && child.signalCode === null)
      signal(child, "SIGKILL");
  if (created) {
    try {
      const remaining = () =>
        docker(
          [
            "ps",
            "--all",
            "--quiet",
            "--filter",
            "name=^/" + containerName + "$",
          ],
          {},
          15000,
        );
      if (remaining()) {
        if (
          docker(
            [
              "inspect",
              "--format",
              '{{ index .Config.Labels "eggdigital.e2e.run" }}',
              containerName,
            ],
            {},
            15000,
          ) !== runId
        )
          throw new Error();
        docker(["rm", "--force", containerName], {}, 15000);
      }
      if (remaining()) throw new Error();
      process.stdout.write(
        "Owned E2E container removed and absence verified.\n",
      );
    } catch {
      process.stderr.write("Owned E2E container cleanup needs attention.\n");
      process.exitCode = 1;
    }
  }
  if (temporary) {
    // Never retain generated credentials with test evidence or diagnostic logs.
    await rm(path.join(temporary, "fixture.json"), { force: true });
    if (!process.exitCode)
      await rm(temporary, { recursive: true, force: true });
  }
  if (interrupted) process.exitCode = 1;
  if (manifest)
    await writeFile(
      path.join(evidence, "run.json"),
      JSON.stringify(
        {
          ...manifest,
          endedAt: new Date().toISOString(),
          status: process.exitCode ? "failed" : "passed",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
}
