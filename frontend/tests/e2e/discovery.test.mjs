import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverCases,
  requireDependencies,
  requireSupportedNode,
} from "./discovery.mjs";

async function fixture(t, source) {
  const directory = await mkdtemp(path.join(tmpdir(), "e2e discovery test "));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "tests/e2e"), { recursive: true });
  await writeFile(path.join(directory, "tests/e2e/auth.browser.mjs"), source);
  return {
    frontend: directory,
    diagnostics: directory,
    env: { PATH: process.env.PATH },
  };
}

test("supported Node boundaries match repository engines and identify the actual runtime", () => {
  for (const version of ["24.19.0", "24.19.1", "24.20.0"])
    requireSupportedNode(version);
  for (const version of ["20.19.1", "24.18.9", "25.0.0", "24.19.0-rc.1"])
    assert.throws(
      () => requireSupportedNode(version),
      (error) => {
        assert.ok(error.message.includes(version));
        assert.match(error.message, /requires Node >=24\.19\.0 <25/);
        assert.match(error.message, /npm ci --prefix frontend --include=dev/);
        return true;
      },
    );
});

test("missing dependency directories identify the correct install command", async (t) => {
  const config = await fixture(t, "");
  for (const name of ["frontend", "backend"])
    await assert.rejects(
      requireDependencies(config.frontend, name),
      new RegExp(`npm ci --prefix ${name} --include=dev`),
    );
  await mkdir(path.join(config.frontend, "node_modules"));
  await requireDependencies(config.frontend, "frontend");
});

test("successful discovery uses explicit cwd and argument arrays with spaces", async (t) => {
  const config = await fixture(
    t,
    `
    import assert from 'node:assert/strict';
    assert.equal(process.argv[2], '--list-cases');
    assert.equal(process.env.E2E_FIXTURE_PATH, undefined);
    console.log(JSON.stringify([{id:'E2E-AUTH-01',suite:'auth',tags:[]}]));
  `,
  );
  assert.deepEqual(await discoverCases("auth", config), [
    { id: "E2E-AUTH-01", suite: "auth", tags: [] },
  ]);
});

test("missing Playwright reports remediation without printing arbitrary child stderr", async (t) => {
  const config = await fixture(t, "import 'playwright';");
  await assert.rejects(
    discoverCases("auth", config),
    /Playwright dependency is missing; run npm ci --prefix frontend --include=dev/,
  );
  const log = path.join(config.diagnostics, "discovery-auth.stderr.log");
  assert.match(await readFile(log, "utf8"), /ERR_MODULE_NOT_FOUND/);
  assert.equal((await stat(log)).mode & 0o777, 0o600);
  assert.equal((await stat(config.diagnostics)).mode & 0o777, 0o700);
});

test("nonzero discovery retains exit evidence privately and never echoes child secrets", async (t) => {
  const sentinel = "private-test-sentinel-do-not-echo";
  const config = await fixture(
    t,
    `console.error('${sentinel}'); process.exit(7);`,
  );
  await assert.rejects(discoverCases("auth", config), (error) => {
    assert.match(error.message, /exit=7/);
    assert.match(error.message, /No browser scenarios have run/);
    assert.ok(!error.message.includes(sentinel));
    return true;
  });
  assert.match(
    await readFile(
      path.join(config.diagnostics, "discovery-auth.stderr.log"),
      "utf8",
    ),
    new RegExp(sentinel),
  );
});

test("zero-exit malformed output is reported without leaking stdout", async (t) => {
  const config = await fixture(t, "console.log('private malformed output');");
  await assert.rejects(discoverCases("auth", config), (error) => {
    assert.match(error.message, /exit=0.*invalid scenario JSON/);
    assert.doesNotMatch(error.message, /private malformed output/);
    return true;
  });
});

test("spawn failure and bounded timeout have distinct actionable evidence", async (t) => {
  const config = await fixture(t, "setInterval(() => {}, 1000);");
  await assert.rejects(
    discoverCases("auth", {
      ...config,
      executable: path.join(config.frontend, "missing-node"),
    }),
    /spawn=ENOENT/,
  );
  await assert.rejects(
    discoverCases("auth", { ...config, timeout: 100 }),
    /spawn=ETIMEDOUT.*timed out after 100ms/,
  );
});

test("output overflow is bounded and distinguished from a scenario failure", async (t) => {
  const config = await fixture(
    t,
    "process.stdout.write('x'.repeat(2 * 1024 * 1024));",
  );
  await assert.rejects(
    discoverCases("auth", config),
    /spawn=ENOBUFS.*output limit/,
  );
});
