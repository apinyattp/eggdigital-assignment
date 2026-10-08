import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { loadFixture, resetFixture } from "./fixture.mjs";

export async function check(assertion, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      return await assertion();
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw last;
}
export async function login(page, account, password) {
  await page.goto(`${process.env.FE_TEST_ORIGIN}/login`);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(password ?? account.password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await page
    .getByRole("navigation", {
      name: "Workspace navigation",
      includeHidden: true,
    })
    .waitFor({ state: "attached" });
}
export async function chooseDate(page, label, date) {
  await page.getByRole("textbox", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose date" });
  // Fixture dates are two days ahead; the calendar's adjacent-month cells include it.
  await dialog.locator(`[data-date="${date}"]`).click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
}
export async function runSuite(suite, execute) {
  const fixture = await loadFixture();
  const origin = process.env.FE_TEST_ORIGIN ?? fixture.origin;
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const engine = process.env.PLAYWRIGHT_BROWSER ?? "chromium";
  assert.ok(["chromium", "webkit"].includes(engine));
  const browser = await { chromium, webkit }[engine].launch({
    headless: process.env.E2E_HEADED !== "1" && !process.env.PWDEBUG,
    ...(engine === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  const directory = path.join(process.env.E2E_EVIDENCE_DIR, engine, suite);
  await fs.mkdir(directory, { recursive: true });
  const results = [];
  const collectTraces = process.env.E2E_TRACE === "1" && !process.env.CI;
  const selectedCase = process.env.E2E_CASE;
  let selectedCount = 0;
  async function run(
    id,
    scenario,
    options = {},
    scope = "real local frontend/backend/PostgreSQL",
  ) {
    if (selectedCase && selectedCase !== id) return;
    selectedCount++;
    const fixture = await resetFixture();
    const actors = [];
    const errors = [];
    async function newActor(actorOptions = {}) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        ...actorOptions,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (
          ["http:", "https:"].includes(url.protocol) &&
          !["127.0.0.1", "localhost"].includes(url.hostname)
        ) {
          errors.push(`Unexpected external request: ${url.origin}`);
          return route.abort();
        }
        return route.continue();
      });
      if (collectTraces)
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: false,
        });
      actors.push({ context, page });
      return { context, page };
    }
    const { context, page } = await newActor(options);
    try {
      await scenario({ browser, context, page, fixture, origin, newActor });
      assert.deepEqual(
        errors,
        [],
        "No unhandled browser errors or external traffic",
      );
      await page.screenshot({
        path: path.join(directory, `${id}.png`),
        fullPage: true,
        mask: [page.getByLabel("Password", { exact: true })],
      });
      if (collectTraces)
        for (const actor of actors) await actor.context.tracing.stop();
      results.push({ id, status: "PASS", scope });
      console.log(`PASS ${engine} ${id}`);
    } catch (error) {
      await page
        .screenshot({
          path: path.join(directory, `${id}-failure.png`),
          fullPage: true,
          mask: [page.getByLabel("Password", { exact: true })],
        })
        .catch(() => {});
      if (collectTraces)
        for (const [index, actor] of actors.entries()) {
          await actor.context.tracing
            .stop({
              path: path.join(directory, `${id}-actor-${index}-trace.zip`),
            })
            .catch(() => {});
        }
      let message = error.message;
      for (const secret of [
        fixture.password,
        process.env.NEXTAUTH_SECRET,
        process.env.AUTH_SERVICE_KEY,
        process.env.JWT_SIGNING_KEY_BASE64,
        process.env.DATABASE_URL,
        process.env.E2E_RUN_TOKEN,
      ]) {
        if (secret) message = message.split(secret).join("[REDACTED]");
      }
      message = message
        .replace(
          /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
          "[REDACTED JWT]",
        )
        .slice(0, 2000);
      results.push({ id, status: "FAIL", scope, error: message });
      console.error(`FAIL ${engine} ${id}`);
    } finally {
      for (const actor of actors) await actor.context.close();
      await fs.writeFile(
        path.join(directory, "results.json"),
        JSON.stringify({ suite, engine, results }, null, 2),
      );
    }
  }
  try {
    await execute({ browser, fixture, origin, run });
    if (selectedCase && selectedCount === 0)
      throw new Error(`Unknown E2E_CASE: ${selectedCase}`);
    const failed = results.filter((result) => result.status === "FAIL");
    if (failed.length)
      throw new Error(
        `${failed.length} ${suite} scenario(s) failed; see results.json`,
      );
  } finally {
    await browser.close();
  }
}
