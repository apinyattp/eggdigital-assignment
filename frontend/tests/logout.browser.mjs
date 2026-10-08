// Local production UI with controlled auth transport and synthetic cookies.
// This exercises browser events, not genuine iOS Safari or backend authentication.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = process.env.FE_TEST_ORIGIN ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const member = {
  user: {
    id: "owner",
    displayName: "Synthetic Owner",
    email: "owner@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
try {
  for (const target of [
    "text",
    "icon",
    "background",
    "blur-before-click",
    "retry",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await context.addCookies(
      ["mm_access", "next-auth.session-token"].map((name) => ({
        name,
        value: "synthetic",
        url: origin,
        httpOnly: true,
      })),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = [];
    let signedIn = true;
    let failLogout = target === "retry";
    const reply = (route, status, body, headers = {}) =>
      route.fulfill({
        status,
        headers: { "Cache-Control": "no-store", ...headers },
        ...(body === undefined
          ? {}
          : { contentType: "application/json", body: JSON.stringify(body) }),
      });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/auth/session")
        return reply(
          route,
          signedIn ? 200 : 401,
          signedIn ? member : { error: { code: "UNAUTHENTICATED" } },
        );
      if (path === "/api/auth/session")
        return reply(route, 200, signedIn ? { expires: member.expiresAt } : {});
      if (path === "/api/auth/csrf")
        return reply(route, 200, { csrfToken: "synthetic" });
      if (path === "/api/auth/attempt") {
        calls.push("cancel");
        return reply(route, 204);
      }
      if (path === "/api/auth/signout") {
        calls.push("signout");
        return reply(
          route,
          200,
          { url: `${origin}/login` },
          {
            "Set-Cookie":
              "next-auth.session-token=; Path=/; Max-Age=0; HttpOnly",
          },
        );
      }
      if (path === "/api/v1/auth/logout") {
        calls.push("backend");
        if (failLogout) {
          failLogout = false;
          return reply(route, 503, {
            error: { code: "DEPENDENCY_UNAVAILABLE" },
          });
        }
        signedIn = false;
        return reply(route, 204, undefined, {
          "Set-Cookie": "mm_access=; Path=/; Max-Age=0; HttpOnly",
        });
      }
      if (path === "/api/v1/meetings")
        return reply(route, 200, {
          date: new URL(route.request().url()).searchParams.get("date"),
          timeZone: "Asia/Bangkok",
          referenceTime: "2026-10-08T03:00:00Z",
          snapshot: "synthetic",
          groups: {
            upcomingCurrent: { items: [], page: 1, pageSize: 10, total: 0 },
            rejectedCancelled: { count: 0, items: [] },
            past: { count: 0, items: [] },
          },
        });
      throw new Error(`Unexpected local route ${path}`);
    });
    await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Account", exact: true }).tap();
    const logout = page
      .locator("header")
      .getByRole("button", { name: "Logout", exact: true });
    await logout.waitFor({ state: "visible" });
    if (target === "text") await logout.locator("span").tap();
    else if (target === "icon") await logout.locator("svg").tap();
    else if (target === "blur-before-click") {
      // Reproduce the problematic ordering explicitly, without claiming this
      // forced event sequence occurs on every Safari version.
      await logout.evaluate((button) => {
        button.addEventListener("pointerdown", () => button.blur(), {
          once: true,
        });
      });
      await logout.tap();
    } else await logout.tap({ position: { x: 4, y: 4 } });
    if (target === "retry") {
      await page.getByRole("button", { name: "Retry sign-out" }).waitFor();
      assert.match(page.url(), /\/dashboard$/);
      assert.equal(
        await page.getByText("Synthetic Owner", { exact: true }).count(),
        0,
      );
      await logout.tap();
    }
    await page.waitForURL(`${origin}/login`, { waitUntil: "domcontentloaded" });
    assert.deepEqual(
      calls,
      target === "retry"
        ? ["cancel", "signout", "backend", "cancel", "signout", "backend"]
        : ["cancel", "signout", "backend"],
    );
    assert.equal(
      (await context.cookies()).filter((c) =>
        ["mm_access", "next-auth.session-token"].includes(c.name),
      ).length,
      0,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${origin}/login`, { waitUntil: "domcontentloaded" });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS mobile logout: ${target}, cookie removal and protected reload`,
    );
  }
} finally {
  await browser.close();
}
