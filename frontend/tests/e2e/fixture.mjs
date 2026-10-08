import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const backend = fileURLToPath(new URL("../../../backend/", import.meta.url));
export async function loadFixture() {
  if (!process.env.E2E_FIXTURE_PATH)
    throw new Error("Run through npm run test:e2e:local");
  return JSON.parse(await readFile(process.env.E2E_FIXTURE_PATH, "utf8"));
}
export async function fixtureAction(action) {
  if (
    !["reset", "inspect", "revokeMember", "expiredAccessToken"].includes(action)
  )
    throw new Error("Unknown fixture action");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/e2e-fixture.ts", action],
    {
      cwd: backend,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.resume();
  let output = "";
  for await (const chunk of child.stdout) output += chunk;
  const code = await new Promise((resolve, reject) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else {
      child.once("error", reject);
      child.once("exit", resolve);
    }
  });
  if (code !== 0) throw new Error(`Owned E2E fixture action failed: ${action}`);
  return JSON.parse(output);
}
export async function resetFixture() {
  await fixtureAction("reset");
  return loadFixture();
}
export const inspectFixture = () => fixtureAction("inspect");
