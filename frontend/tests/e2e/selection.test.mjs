import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SUITES,
  collectCases,
  metadata,
  readSelectionRequest,
  selectCases,
  selectRegisteredCases,
  summarizeResults,
} from "./selection.mjs";

const frontend = fileURLToPath(new URL("../../", import.meta.url));
const inventory = SUITES.flatMap((suite) => {
  const result = spawnSync(
    process.execPath,
    [`tests/e2e/${suite}.browser.mjs`, "--list-cases"],
    {
      cwd: frontend,
      encoding: "utf8",
      timeout: 20_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
  assert.equal(
    result.status,
    0,
    `Read-only discovery of ${suite} succeeds without fixture credentials`,
  );
  return JSON.parse(result.stdout);
});
const select = (env, cases = inventory) =>
  selectCases(cases, readSelectionRequest(env));

test("default full preserves all27 cases and critical tags select the agreed8", () => {
  assert.equal(select({}).length, 27);
  assert.deepEqual(
    select({ E2E_PROFILE: "critical" }).map(({ id }) => id),
    [
      "E2E-AUTH-01-password-and-protected-route",
      "E2E-AUTH-03-mobile-logout-and-reload",
      "E2E-MEMBER-01",
      "E2E-CREATE-ONSITE",
      "E2E-CREATE-ONLINE",
      "E2E-EDIT-01",
      "E2E-DELETE-01",
      "E2E-NAVIGATION-01",
    ],
  );
  assert.deepEqual(
    [...new Set(select({ E2E_PROFILE: "critical" }).map(({ suite }) => suite))],
    ["auth", "meetings"],
  );
});
test("suite/case debug filters intersect the profile without dropping noncritical full cases", () => {
  assert.equal(select({ E2E_SUITE: "auth" }).length, 9);
  assert.equal(
    select({ E2E_PROFILE: "critical", E2E_SUITE: "auth" }).length,
    2,
  );
  assert.equal(
    select({ E2E_SUITE: "authorization", E2E_CASE: "E2E-NOTES-01" }).length,
    1,
  );
  assert.throws(
    () => select({ E2E_PROFILE: "critical", E2E_SUITE: "authorization" }),
    /zero scenarios/,
  );
  assert.throws(
    () =>
      select({
        E2E_PROFILE: "critical",
        E2E_SUITE: "auth",
        E2E_CASE: "E2E-AUTH-09-injected-session-error-retry",
      }),
    /zero scenarios/,
  );
});
test("unknown profiles, suites and missing or wrong-suite case IDs fail", () => {
  assert.throws(() => select({ E2E_PROFILE: "smoke" }), /E2E_PROFILE/);
  assert.throws(() => select({ E2E_PROFILE: "" }), /E2E_PROFILE/);
  assert.throws(() => select({ E2E_SUITE: "unknown" }), /E2E_SUITE/);
  assert.throws(
    () => select({ E2E_CASE: "E2E-NOTES-01" }),
    /requires E2E_SUITE/,
  );
  assert.throws(
    () => select({ E2E_SUITE: "auth", E2E_CASE: "E2E-UNKNOWN" }),
    /Unknown E2E_CASE/,
  );
  assert.throws(
    () => select({ E2E_SUITE: "auth", E2E_CASE: "E2E-NOTES-01" }),
    /Unknown E2E_CASE/,
  );
});
test("missing scenarios/tags and duplicate scenario IDs cannot silently shrink coverage", () => {
  assert.throws(() => select({}, inventory.slice(1)), /27 cases/);
  assert.throws(
    () =>
      select(
        {},
        inventory.map((entry, index) =>
          index === 0 ? { ...entry, tags: [] } : entry,
        ),
      ),
    /8 @critical/,
  );
  assert.throws(
    () => select({}, [inventory[0], ...inventory.slice(0, -1)]),
    /duplicate scenario IDs/,
  );
  assert.throws(() => select({}, []), /inventory is empty/);
});
test("registration does not execute scenarios and strips tags from context options", async () => {
  let executed = false;
  const cases = await collectCases("auth", async ({ run }) => {
    await run(
      "E2E-REGISTER",
      async () => {
        executed = true;
      },
      {
        tags: ["@critical"],
        hasTouch: true,
        viewport: { width: 390, height: 844 },
      },
      "controlled test scope",
    );
  });
  assert.equal(executed, false);
  assert.deepEqual(cases[0].contextOptions, {
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  assert.deepEqual(metadata(cases), [
    { id: "E2E-REGISTER", suite: "auth", tags: ["@critical"] },
  ]);
  assert.equal(cases[0].scope, "controlled test scope");
  await assert.rejects(
    collectCases("auth", async ({ run }) => {
      await run("E2E-REGISTER", () => {}, { tags: ["@critcal"] });
    }),
    /Unknown or duplicate tags/,
  );
});
test("registered suite selection rejects zero, duplicate or missing selected IDs", () => {
  const auth = inventory.filter(({ suite }) => suite === "auth");
  const id = auth[0].id;
  assert.equal(selectRegisteredCases(auth, [id]).length, 1);
  assert.throws(() => selectRegisteredCases(auth, []), /must not be empty/);
  assert.throws(() => selectRegisteredCases(auth, [id, id]), /duplicate/);
  assert.throws(() => selectRegisteredCases(auth, ["E2E-NOTES-01"]), /missing/);
});
test("result accounting identifies missing results and rejects duplicate/unselected/invalid results", () => {
  const ids = ["E2E-FIRST", "E2E-SECOND"];
  assert.deepEqual(summarizeResults([{ id: ids[0], status: "PASS" }], ids), {
    completed: 1,
    passed: 1,
    failed: 0,
    missing: [ids[1]],
  });
  assert.deepEqual(summarizeResults([], ids).missing, ids);
  assert.deepEqual(
    summarizeResults(
      [
        { id: ids[0], status: "PASS" },
        { id: ids[1], status: "FAIL" },
      ],
      ids,
    ),
    { completed: 2, passed: 1, failed: 1, missing: [] },
  );
  assert.throws(
    () =>
      summarizeResults(
        [
          { id: ids[0], status: "PASS" },
          { id: ids[0], status: "PASS" },
        ],
        ids,
      ),
    /duplicate/,
  );
  assert.throws(
    () => summarizeResults([{ id: "E2E-OTHER", status: "PASS" }], ids),
    /Unexpected/,
  );
  assert.throws(
    () => summarizeResults([{ id: ids[0], status: "SKIP" }], ids),
    /Unexpected/,
  );
});
test("runner rejects invalid/unknown/empty selectors before database or build startup", () => {
  for (const selection of [
    { E2E_PROFILE: "unknown" },
    { E2E_SUITE: "auth", E2E_CASE: "E2E-UNKNOWN" },
    { E2E_PROFILE: "critical", E2E_SUITE: "authorization" },
  ]) {
    const result = spawnSync(process.execPath, ["tests/e2e/run-local.mjs"], {
      cwd: frontend,
      encoding: "utf8",
      timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...selection },
    });
    assert.equal(result.status, 1);
    assert.doesNotMatch(
      result.stdout,
      /Creating an owned|Building the real|Running .*serial/,
    );
    assert.match(result.stderr, /E2E_PROFILE|Unknown E2E_CASE|zero scenarios/);
  }
});
