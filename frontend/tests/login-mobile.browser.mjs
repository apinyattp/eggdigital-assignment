// Responsive Chromium/WebKit checks; desktop emulation cannot prove physical iOS rubber-banding.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const origin = process.env.FE_TEST_ORIGIN ?? "http://127.0.0.1:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const engines = (process.env.PICKER_BROWSERS ?? "chromium").split(",");
assert.ok(engines.every((name) => ["chromium", "webkit"].includes(name)));
const results = [];
for (const engine of engines) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    ...(engine === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    // 402x874 at DPR3 approximates 1206x2622 pixels; browser chrome/keyboard differ on hardware.
    for (const [width, height] of [[402, 874], [402, 700], [402, 450], [320, 568], [390, 844], [1440, 1000]]) {
      const mobile = width < 1100;
      const context = await browser.newContext({
        viewport: { width, height }, deviceScaleFactor: mobile ? 3 : 1,
        hasTouch: mobile, isMobile: mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname === "/api/auth/session")
          return route.fulfill({ json: {} });
        if (url.pathname === "/api/v1/auth/session")
          return route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED" } } });
        errors.push(`Unexpected API request: ${route.request().method()} ${url.pathname}`);
        return route.abort();
      });
      const result = { engine, width, height, status: "failed" };
      try {
        await page.goto(`${origin}/login`);
        await page.waitForFunction(() => !document.querySelector("#email")?.disabled);
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
          const root = document.documentElement;
          const style = getComputedStyle(root);
          scrollTo(10000, 10000);
          return {
            width: innerWidth, scrollWidth: root.scrollWidth,
            height: innerHeight, scrollHeight: root.scrollHeight,
            scrollX, scrollY, overscrollX: style.overscrollBehaviorX,
            overscrollY: style.overscrollBehaviorY,
            touchAction: getComputedStyle(document.querySelector("main")).touchAction,
            viewport: document.querySelector('meta[name="viewport"]')?.content ?? "",
          };
        });
        assert.equal(geometry.scrollWidth, geometry.width);
        assert.equal(geometry.scrollX, 0);
        assert.equal(geometry.overscrollX, mobile ? "none" : "auto");
        assert.equal(geometry.overscrollY, mobile ? "none" : "auto");
        if (geometry.scrollHeight > geometry.height) assert.ok(geometry.scrollY > 0);
        assert.equal(geometry.touchAction, "auto");
        assert.doesNotMatch(geometry.viewport, /user-scalable\s*=\s*(no|0)|maximum-scale/i);
        const button = page.getByRole("button", { name: "Login", exact: true });
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.boundingBox();
        assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
        await page.getByLabel("Email", { exact: true }).fill("mobile@example.test");
        await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
        await page.getByRole("button", { name: "Show password" }).click();
        assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "synthetic-password");
        assert.equal(await page.evaluate(() => scrollX), 0);
        await page.evaluate(() => scrollTo(0, 0));
        if (process.env.PICKER_SCREENSHOT_DIR && width === 402)
          await page.screenshot({ path: `${process.env.PICKER_SCREENSHOT_DIR}/${engine}-login-${width}x${height}.png`, fullPage: true });
        // Login-only CSS must stop applying after leaving Login.
        await page.goto(`${origin}/nonexistent-mobile-check`);
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorX), "auto");
        assert.deepEqual(errors, []);
        result.geometry = geometry;
        result.status = "passed";
      } catch (error) {
        result.error = error.message;
      } finally {
        results.push(result);
        await context.close();
      }
      console.log(`${result.status === "passed" ? "PASS" : "FAIL"} ${engine} ${width}x${height}${result.error ? `: ${result.error}` : ""}`);
    }
  } finally {
    await browser.close();
  }
}
if (process.env.PICKER_EVIDENCE_PATH)
  await writeFile(process.env.PICKER_EVIDENCE_PATH, JSON.stringify(results, null, 2));
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
