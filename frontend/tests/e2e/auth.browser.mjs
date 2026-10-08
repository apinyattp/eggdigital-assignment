// Real local NextAuth -> Express -> PostgreSQL unless a scenario explicitly injects transport failure/timing.
import assert from "node:assert/strict";
import { check, login, runSuite } from "./helpers.mjs";
import { fixtureAction } from "./fixture.mjs";

const mobile = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};
const faultScope =
  "real local stack with explicitly injected HTTP failure or timing";
const isSessionCookie = (name) =>
  name === "mm_access" ||
  /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(name);
const deferred = () => {
  let done;
  let resolved = false;
  const promise = new Promise((resolve) => {
    done = resolve;
  });
  return {
    promise,
    get resolved() {
      return resolved;
    },
    resolve() {
      resolved = true;
      done();
    },
  };
};
async function logoutButton(page, touch = false) {
  const toggle = page.getByRole("button", { name: "Account", exact: true });
  if (await toggle.isVisible()) {
    if (touch) await toggle.tap();
    else await toggle.click();
  }
  const button = page
    .locator("header")
    .getByRole("button", { name: "Logout", exact: true });
  await button.waitFor({ state: "visible" });
  return button;
}
async function assertSignedOut({ page, context, origin }) {
  await page.waitForURL(`${origin}/login`);
  assert.deepEqual(
    (await context.cookies())
      .filter(({ name }) => isSessionCookie(name))
      .map(({ name }) => name),
    [],
    "Both application and library session cookies are cleared",
  );
  assert.equal(
    (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
    401,
  );
  await page.reload();
  await page.goto(`${origin}/dashboard`);
  await page.waitForURL(`${origin}/login`);
  await page.getByRole("button", { name: "Login", exact: true }).waitFor();
}
async function session(context, origin) {
  const response = await context.request.get(`${origin}/api/v1/auth/session`);
  assert.equal(response.status(), 200);
  return response.json();
}

await runSuite("auth", async ({ run }) => {
  await run(
    "E2E-AUTH-01-password-and-protected-route",
    async ({ page, context, origin, fixture }) => {
      await page.goto(`${origin}/dashboard`);
      await page.waitForURL(`${origin}/login`);
      await page.getByRole("button", { name: "Login", exact: true }).click();
      assert.equal(
        await page
          .getByLabel("Email", { exact: true })
          .evaluate((input) => input.validity.valueMissing),
        true,
      );
      await page
        .getByLabel("Email", { exact: true })
        .fill(fixture.accounts.owner.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(`${fixture.password}-incorrect`);
      await page.getByRole("button", { name: "Login", exact: true }).click();
      await page
        .getByText("Incorrect email or password.", { exact: true })
        .waitFor();
      assert.equal(
        (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
        401,
      );
      await login(page, fixture.accounts.owner, fixture.password);
      assert.equal(
        (await session(context, origin)).user.id,
        fixture.accounts.owner.id,
      );
      await page.reload();
      await page
        .getByText(fixture.accounts.owner.displayName, { exact: true })
        .waitFor({ state: "attached" });
      assert.equal(
        (await session(context, origin)).user.id,
        fixture.accounts.owner.id,
      );
    },
  );

  await run(
    "E2E-AUTH-02-candidate-and-password-ineligible",
    async ({ page, context, origin, fixture }) => {
      for (const [account, message] of [
        [
          fixture.accounts.candidate,
          "Candidate accounts cannot access this system.",
        ],
        [fixture.accounts.googleOnly, "Incorrect email or password."],
      ]) {
        await page.goto(`${origin}/login`);
        await page.getByLabel("Email", { exact: true }).fill(account.email);
        await page
          .getByLabel("Password", { exact: true })
          .fill(fixture.password);
        await page.getByRole("button", { name: "Login", exact: true }).click();
        await page.getByText(message, { exact: true }).waitFor();
        assert.equal(
          (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
          401,
        );
      }
    },
  );

  await run(
    "E2E-AUTH-03-mobile-logout-and-reload",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.owner, fixture.password);
      await page
        .getByText(fixture.accounts.owner.displayName, { exact: true })
        .waitFor({ state: "attached" });
      const button = await logoutButton(page, true);
      await button.locator("span").tap();
      await assertSignedOut({ page, context, origin });
    },
    mobile,
  );

  await run(
    "E2E-AUTH-04-keyboard-and-account-switch",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.owner, fixture.password);
      const toggle = page.getByRole("button", { name: "Account", exact: true });
      await toggle.focus();
      await page.keyboard.press("Enter");
      const button = page
        .locator("header")
        .getByRole("button", { name: "Logout", exact: true });
      await check(async () =>
        assert.equal(
          await button.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
        ),
      );
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert.equal(
        await toggle.evaluate((element) => element === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      await button.press("Enter");
      await assertSignedOut({ page, context, origin });
      await login(page, fixture.accounts.attendee, fixture.password);
      assert.equal(
        (await session(context, origin)).user.id,
        fixture.accounts.attendee.id,
      );
      assert.equal(
        await page
          .getByText(fixture.accounts.owner.displayName, { exact: true })
          .count(),
        0,
      );
    },
    { viewport: { width: 390, height: 844 } },
  );

  await run(
    "E2E-AUTH-05-expired-signed-token",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.owner, fixture.password);
      const accessCookies = (await context.cookies()).filter(
        ({ name }) => name === "mm_access",
      );
      assert.ok(accessCookies.length > 0);
      const { token } = await fixtureAction("expiredAccessToken");
      // Preserve the real cookie's scope/expiry: rejection must come from JWT expiry, not cookie removal.
      await context.addCookies(
        accessCookies.map((cookie) => ({ ...cookie, value: token })),
      );
      assert.equal(
        (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
        401,
      );
      await page.reload();
      await page.waitForURL(`${origin}/login`);
      assert.equal(
        await page
          .getByText(fixture.accounts.owner.displayName, { exact: true })
          .count(),
        0,
      );
    },
  );

  await run(
    "E2E-AUTH-06-current-membership-revocation",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.revocable, fixture.password);
      assert.equal(
        (await session(context, origin)).user.id,
        fixture.accounts.revocable.id,
      );
      await fixtureAction("revokeMember");
      assert.equal(
        (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
        401,
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForURL(`${origin}/login`);
      assert.equal(
        await page
          .getByText(fixture.accounts.revocable.displayName, { exact: true })
          .count(),
        0,
      );
      await page.goto(`${origin}/dashboard`);
      await page.waitForURL(`${origin}/login`);
    },
  );

  await run(
    "E2E-AUTH-07-injected-logout-retry-and-repeat",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.owner, fixture.password);
      const received = deferred(),
        release = deferred();
      let requests = 0;
      await page.route("**/api/v1/auth/logout", async (route) => {
        requests++;
        if (requests > 1) return route.continue();
        received.resolve();
        await release.promise;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }),
        });
      });
      try {
        const button = await logoutButton(page, true);
        await button.evaluate((element) => {
          element.click();
          element.click();
        });
        await check(() =>
          assert.equal(
            received.resolved,
            true,
            "Expected request reached the injected gate",
          ),
        );
        assert.equal(requests, 1, "Repeated clicks share the pending logout");
        assert.equal(
          await page
            .getByText(fixture.accounts.owner.displayName, { exact: true })
            .count(),
          0,
        );
        release.resolve();
        await page
          .getByRole("button", { name: "Retry sign-out", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).pathname, "/dashboard");
        await page.locator("header img").tap();
        await page
          .getByRole("button", { name: "Retry sign-out", exact: true })
          .tap();
        await assertSignedOut({ page, context, origin });
        assert.equal(requests, 2);
      } finally {
        release.resolve();
      }
    },
    mobile,
    faultScope,
  );

  await run(
    "E2E-AUTH-08-injected-interrupted-completion",
    async ({ page, context, origin, fixture }) => {
      const headers = { Origin: origin, "X-Requested-With": "MeetingManager" };
      assert.equal(
        (
          await context.request.post(`${origin}/api/auth/attempt`, {
            headers,
            data: { action: "start" },
          })
        ).status(),
        200,
      );
      const { csrfToken } = await (
        await context.request.get(`${origin}/api/auth/csrf`)
      ).json();
      const credentials = await context.request.post(
        `${origin}/api/auth/callback/credentials`,
        {
          headers,
          form: {
            csrfToken,
            email: fixture.accounts.owner.email,
            password: fixture.password,
            callbackUrl: `${origin}/login?complete=1`,
            json: "true",
          },
        },
      );
      assert.equal(credentials.status(), 200);
      const destination = new URL((await credentials.json()).url);
      assert.equal(destination.origin, origin);
      assert.equal(destination.searchParams.get("complete"), "1");
      const received = deferred(),
        release = deferred();
      await page.route("**/api/auth/complete", async (route) => {
        received.resolve();
        await release.promise;
        return route.continue();
      });
      try {
        await page.goto(`${origin}/login?complete=1`);
        await check(() =>
          assert.equal(
            received.resolved,
            true,
            "Expected request reached the injected gate",
          ),
        );
        const cancelled = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/auth/attempt" &&
            response.status() === 204,
        );
        await page
          .getByRole("button", { name: "Cancel and sign out", exact: true })
          .click();
        await cancelled;
        release.resolve();
        await check(async () =>
          assert.equal(
            await page
              .getByRole("button", { name: "Login", exact: true })
              .isEnabled(),
            true,
          ),
        );
        await assertSignedOut({ page, context, origin });
      } finally {
        release.resolve();
      }
    },
    {},
    faultScope,
  );

  await run(
    "E2E-AUTH-09-injected-session-error-retry",
    async ({ page, context, origin, fixture }) => {
      await login(page, fixture.accounts.owner, fixture.password);
      let requests = 0;
      let unavailable = true;
      await page.route("**/api/v1/auth/session", async (route) => {
        requests++;
        if (!unavailable) return route.continue();
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }),
        });
      });
      // Reload starts a new identity check instead of racing login's in-flight refresh.
      const failedRead = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/auth/session" &&
          response.status() === 503,
      );
      await Promise.all([page.reload(), failedRead]);
      await page
        .getByRole("button", { name: "Check account again", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByText(fixture.accounts.owner.displayName, { exact: true })
          .count(),
        0,
      );
      unavailable = false;
      await page
        .getByRole("button", { name: "Check account again", exact: true })
        .click();
      await page
        .getByText(fixture.accounts.owner.displayName, { exact: true })
        .waitFor({ state: "attached" });
      assert.equal(
        (await session(context, origin)).user.id,
        fixture.accounts.owner.id,
      );
      assert.ok(requests >= 2);
    },
    {},
    faultScope,
  );
});
