// Browser integration against controlled HTTP/provider responses, NOT genuine Google or BE/PG evidence.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const origin = process.env.FE_TEST_ORIGIN ?? "http://localhost:3000";
const output = process.env.FE_EVIDENCE_DIR;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  headless: true,
});
const results = [];
const member = {
  user: {
    id: "10000000-0000-4000-8000-000000000001",
    displayName: "Synthetic Current Member",
    email: "member@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
const googleMember = {
  ...member,
  user: {
    id: "10000000-0000-4000-8000-000000000002",
    displayName: "<script>synthetic Google member</script>",
    email: "google-member@example.test",
    membership: "member",
  },
};
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function waitFor(assertion) {
  const deadline = Date.now() + 7000;
  let last;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      last = error;
      await new Promise((yes) => setTimeout(yes, 30));
    }
  }
  throw last;
}
async function harness(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = {
    current: null,
    sessionError: null,
    passwordError: null,
    passwordGate: null,
    completionGate: null,
    logoutFailure: 0,
    logoutCount: 0,
    calls: [],
    events: [],
    authorizationUrl:
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-provider-state",
    queryCleared: false,
  };
  await page.route("**/api/auth/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace("/api/auth/", "");
    const respond = (status, body, extra = {}) =>
      route.fulfill({
        status,
        headers: { "Cache-Control": "no-store", ...extra },
        ...(body === undefined
          ? {}
          : { contentType: "application/json", body: JSON.stringify(body) }),
      });
    if (endpoint === "csrf")
      return respond(200, { csrfToken: "synthetic-csrf" });
    if (endpoint === "providers")
      return respond(200, {
        credentials: {
          id: "credentials",
          type: "credentials",
          signinUrl: `${origin}/api/auth/signin/credentials`,
          callbackUrl: `${origin}/api/auth/callback/credentials`,
        },
      });
    if (endpoint === "session")
      return respond(
        200,
        state.current ? { expires: state.current.expiresAt } : {},
      );
    if (endpoint === "signout") return respond(200, { url: `${origin}/login` });
    if (endpoint === "signin/google") {
      assert.equal(request.headers().accept, "application/json");
      if (state.googleHttpRedirect)
        return respond(302, undefined, {
          Location: "https://unapproved.example.test/redirect-target",
        });
      const form = new URLSearchParams(request.postData());
      assert.equal(form.get("csrfToken"), "synthetic-csrf");
      assert.equal(form.get("json"), "true");
      return respond(200, { url: state.authorizationUrl });
    }
    if (endpoint === "callback/credentials") {
      const form = new URLSearchParams(request.postData());
      assert.equal(form.get("email"), "member@example.test");
      assert.equal(form.get("password"), " synthetic password ");
      if (state.passwordGate) await state.passwordGate.promise;
      return respond(state.passwordError ? 401 : 200, {
        url: state.passwordError
          ? `${origin}/login?error=INVALID_CREDENTIALS`
          : `${origin}/login?complete=1`,
      });
    }
    assert.equal(request.headers()["x-requested-with"], "MeetingManager");
    if (endpoint === "attempt") {
      if (request.postDataJSON().action === "start")
        return respond(200, { ok: true });
      state.logoutCount++;
      state.events.push(`logout-${state.logoutCount}`);
      if (state.logoutFailure === state.logoutCount)
        return respond(503, { error: { code: "DEPENDENCY_UNAVAILABLE" } });
      state.current = null;
      return respond(204, undefined, {
        "Set-Cookie":
          "mm_access=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0",
      });
    }
    if (endpoint === "complete") {
      state.queryCleared = new URL(page.url()).search === "";
      if (state.completionGate) await state.completionGate.promise;
      state.current = state.completionUser ?? member;
      state.events.push("complete-response");
      return respond(
        200,
        { ok: true, expiresAt: state.current.expiresAt },
        {
          "Set-Cookie":
            "mm_access=synthetic-browser-cookie; HttpOnly; Path=/api; SameSite=Lax",
        },
      );
    }
    throw new Error(`Unexpected auth endpoint ${endpoint}`);
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(
      "/api/v1/auth/",
      "",
    );
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Content-Type,X-Requested-With",
      "Cache-Control": "no-store",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (new URL(request.url()).pathname === "/api/v1/meetings") {
      assert.equal(request.method(), "GET");
      assert.ok(state.current?.user.membership === "member");
      return route.fulfill({
        status: 200,
        headers,
        contentType: "application/json",
        body: JSON.stringify({
          date: new URL(request.url()).searchParams.get("date"),
          timeZone: "Asia/Bangkok",
          referenceTime: new Date().toISOString(),
          snapshot: "auth-test-empty-list",
          groups: {
            upcomingCurrent: {
              items: [],
              page: 1,
              pageSize: 10,
              total: 0,
              totalPages: 0,
            },
            rejectedCancelled: { count: 0, items: [] },
            past: { count: 0, items: [] },
          },
        }),
      });
    }
    state.calls.push(endpoint);
    assert.ok(
      ["session", "login", "logout"].includes(endpoint),
      "Only current auth endpoints or the empty Member dashboard fixture are allowed",
    );
    const respond = (status, body, extra = {}) =>
      route.fulfill({
        status,
        headers: { ...headers, ...extra },
        ...(body === undefined
          ? {}
          : { contentType: "application/json", body: JSON.stringify(body) }),
      });
    const error = (status, code) =>
      respond(status, {
        error: { code, message: "Untrusted server text must not render" },
        requestId: "synthetic-request",
      });
    if (endpoint === "session") {
      if (state.sessionError)
        return error(
          state.sessionError,
          state.sessionError === 403
            ? "CANDIDATE_DENIED"
            : "DEPENDENCY_UNAVAILABLE",
        );
      return state.current
        ? respond(200, state.current)
        : error(401, "UNAUTHENTICATED");
    }
    assert.equal(request.method(), "POST");
    assert.equal(request.headers()["x-requested-with"], "MeetingManager");
    assert.equal(request.headers()["content-type"], "application/json");
    assert.equal(request.headers().authorization, undefined);
    if (endpoint === "login") {
      assert.deepEqual(request.postDataJSON(), {
        email: "member@example.test",
        password: " synthetic password ",
      });
      if (state.passwordGate) await state.passwordGate.promise;
      if (state.passwordError) return error(401, "INVALID_CREDENTIALS");
      state.current = member;
      return respond(200, {
        ...member,
        user: { ...member.user, displayName: "Stale login response name" },
      });
    }
    if (endpoint === "logout") {
      state.current = null;
      return respond(204, undefined, {
        "Set-Cookie":
          "mm_access=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0",
      });
    }
  });
  return { context, page, state, errors };
}
async function run(name, execute) {
  if (process.env.FE_TEST_FILTER && !name.includes(process.env.FE_TEST_FILTER))
    return;
  await execute();
  results.push({
    name,
    result: "PASS",
    scope: "mocked HTTP/provider boundary",
  });
  console.log(`PASS ${name}`);
}
async function readyLogin(page) {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await waitFor(async () =>
    assert.equal(
      await page
        .getByRole("button", { name: "Login", exact: true })
        .isEnabled(),
      true,
    ),
  );
}
async function fillLogin(page) {
  await page
    .getByRole("textbox", { name: "Email" })
    .fill("Member@Example.Test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(" synthetic password ");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(
    await page.getByLabel("Password", { exact: true }).inputValue(),
    " synthetic password ",
  );
  assert.equal(
    await page.getByLabel("Password", { exact: true }).isEnabled(),
    true,
  );
}
async function screenshot(page, name) {
  if (output)
    await page.screenshot({ path: path.join(output, name), fullPage: true });
}
try {
  if (output) await fs.mkdir(output, { recursive: true });
  await run(
    "TEST-MM-052 responsive/focus/password visibility across seven widths",
    async () => {
      const references = process.env.FE_REFERENCE_METRICS
        ? JSON.parse(
            await fs.readFile(process.env.FE_REFERENCE_METRICS, "utf8"),
          )
        : null;
      const measures = [];
      for (const width of [320, 390, 768, 1024, 1100, 1101, 1440]) {
        const h = await harness({ width, height: 1000 });
        try {
          await readyLogin(h.page);
          await h.page.evaluate(() => document.fonts.ready);
          const measured = await h.page.evaluate(() => {
            const card = document.querySelector(
              '[aria-labelledby="login-title"]',
            );
            const bounds = (e) => {
              const r = e.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            };
            const controls = {
              card,
              google: card.querySelector("button"),
              login: card.querySelector('[type="submit"]'),
              title: card.querySelector("h2"),
              email: card.querySelector("#email"),
              password: card.querySelector("#password"),
            };
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              rects: Object.fromEntries(
                Object.entries(controls).map(([key, e]) => [key, bounds(e)]),
              ),
            };
          });
          assert.equal(measured.overflow, false);
          assert.equal(measured.rects.google.width, measured.rects.login.width);
          if (references) {
            const ref = references.results.find((r) => r.width === width)
              .expected.rects;
            for (const key of Object.keys(ref))
              for (const dim of Object.keys(ref[key]))
                assert.ok(
                  Math.abs(ref[key][dim] - measured.rects[key][dim]) < 1,
                  `reference ${width} ${key}.${dim}`,
                );
          }
          await screenshot(h.page, `login-${width}.png`);
          for (const control of [
            h.page.getByRole("button", { name: "Sign in with Google" }),
            h.page.getByRole("textbox", { name: "Email" }),
            h.page.getByLabel("Password", { exact: true }),
            h.page.getByRole("button", { name: "Show password" }),
          ]) {
            await h.page.keyboard.press("Tab");
            assert.equal(
              await control.evaluate(
                (e) =>
                  e === document.activeElement &&
                  getComputedStyle(e).outlineStyle !== "none",
              ),
              true,
            );
          }
          await h.page.keyboard.press("Space");
          assert.equal(
            await h.page
              .getByLabel("Password", { exact: true })
              .getAttribute("type"),
            "text",
          );
          await h.page.keyboard.press("Enter");
          assert.equal(
            await h.page
              .getByLabel("Password", { exact: true })
              .getAttribute("type"),
            "password",
          );
          assert.deepEqual(h.errors, []);
          measures.push({ width, ...measured });
        } catch (error) {
          await screenshot(h.page, "failure.png");
          console.error(
            JSON.stringify({
              calls: h.state.calls,
              events: h.state.events,
              pageErrors: h.errors,
              visibleText: await h.page.locator("main").innerText(),
            }),
          );
          throw error;
        } finally {
          await h.context.close();
        }
      }
      if (output)
        await fs.writeFile(
          path.join(output, "visual-measurements.json"),
          JSON.stringify(measures, null, 2),
        );
    },
  );
  await run(
    "TEST-MM-041/052 password pending, current identity, logout, root/direct guards",
    async () => {
      const h = await harness();
      try {
        await h.page.goto(origin);
        await h.page.waitForURL(`${origin}/login`);
        await waitFor(async () =>
          assert.equal(
            await h.page
              .getByRole("button", { name: "Login", exact: true })
              .isEnabled(),
            true,
          ),
        );
        await fillLogin(h.page);
        h.state.passwordGate = deferred();
        await h.page
          .getByRole("button", { name: "Login", exact: true })
          .click();
        await waitFor(async () =>
          assert.equal(
            await h.page
              .getByRole("button", { name: "Sign in with Google" })
              .isDisabled(),
            true,
          ),
        );
        assert.equal(
          await h.page
            .getByRole("button", { name: /Login/ })
            .getAttribute("aria-busy"),
          "true",
        );
        await screenshot(h.page, "password-pending.png");
        h.state.passwordGate.resolve();
        await h.page.waitForURL(`${origin}/dashboard`);
        await h.page.getByText(member.user.displayName).waitFor();
        assert.equal(
          await h.page.getByText("Stale login response name").count(),
          0,
        );
        await screenshot(h.page, "member-landing.png");
        await h.page
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await h.page
          .getByRole("button", { name: "Logout", exact: true })
          .click();
        await h.page.waitForURL(`${origin}/login`);
        assert.equal(h.state.logoutCount, 1);
        await h.page.goto(`${origin}/dashboard`);
        await h.page.waitForURL(`${origin}/login`);
        assert.deepEqual(h.errors, []);
      } catch (error) {
        await screenshot(h.page, "failure.png");
        console.error(
          JSON.stringify({
            calls: h.state.calls,
            events: h.state.events,
            pageErrors: h.errors,
            visibleText: await h.page.locator("main").innerText(),
          }),
        );
        throw error;
      } finally {
        await h.context.close();
      }
    },
  );
  await run(
    "TEST-MM-041/049 session 403/503 retry and expiry without stale identity",
    async () => {
      const h = await harness();
      try {
        h.state.sessionError = 503;
        await h.page.goto(`${origin}/dashboard`);
        await h.page.locator('main [role="alert"]').waitFor();
        assert.equal(await h.page.getByText(member.user.email).count(), 0);
        await screenshot(h.page, "session-unavailable.png");
        h.state.sessionError = 403;
        await h.page
          .getByRole("button", { name: "Check account again" })
          .click();
        await h.page
          .getByText("Candidate accounts cannot access this system.")
          .waitFor();
        h.state.sessionError = null;
        h.state.current = {
          ...member,
          expiresAt: new Date(Date.now() + 1800).toISOString(),
        };
        await h.page
          .getByRole("button", { name: "Check account again" })
          .click();
        await h.page
          .getByText(member.user.displayName, { exact: true })
          .waitFor();
        h.state.current = null;
        await h.page.waitForURL(`${origin}/login`);
        assert.equal(await h.page.getByText(member.user.email).count(), 0);
        assert.deepEqual(h.errors, []);
      } catch (error) {
        await screenshot(h.page, "failure.png");
        console.error(
          JSON.stringify({
            calls: h.state.calls,
            events: h.state.events,
            pageErrors: h.errors,
            visibleText: await h.page.locator("main").innerText(),
          }),
        );
        throw error;
      } finally {
        await h.context.close();
      }
    },
  );
  await run("TEST-MM-052 generic credential failure and retry", async () => {
    const h = await harness({ width: 390, height: 900 });
    try {
      h.state.passwordError = true;
      await readyLogin(h.page);
      await fillLogin(h.page);
      await h.page.getByRole("button", { name: "Login", exact: true }).click();
      await h.page.getByText("Incorrect email or password.").waitFor();
      assert.equal(
        await h.page.getByText("Untrusted server text must not render").count(),
        0,
      );
      assert.equal(
        await h.page.getByLabel("Password", { exact: true }).inputValue(),
        " synthetic password ",
      );
      await screenshot(h.page, "password-error-390.png");
      h.state.passwordError = false;
      await h.page.getByRole("button", { name: "Login", exact: true }).click();
      await h.page.waitForURL(`${origin}/dashboard`);
      assert.deepEqual(h.errors, []);
    } catch (error) {
      await screenshot(h.page, "failure.png");
      console.error(
        JSON.stringify({
          calls: h.state.calls,
          events: h.state.events,
          pageErrors: h.errors,
          visibleText: await h.page.locator("main").innerText(),
        }),
      );
      throw error;
    } finally {
      await h.context.close();
    }
  });
  await run(
    "TEST-MM-041 Google completion captures/scrubs query, renders registered Member safely",
    async () => {
      const h = await harness();
      try {
        h.state.completionUser = googleMember;
        await h.page.goto(`${origin}/login?complete=1`);
        await h.page.waitForURL(`${origin}/dashboard`);
        await h.page
          .getByText(googleMember.user.displayName, { exact: true })
          .waitFor();
        assert.equal(h.state.queryCleared, true);
        assert.equal(
          await h.page
            .getByRole("navigation", { name: "Workspace navigation" })
            .count(),
          1,
        );
        assert.equal(
          await h.page
            .locator("script")
            .filter({ hasText: "synthetic Google member" })
            .count(),
          0,
        );
        assert.equal(
          await h.page.evaluate(
            () => localStorage.length + sessionStorage.length,
          ),
          0,
        );
        await screenshot(h.page, "google-member-landing.png");
        assert.deepEqual(h.errors, []);
      } catch (error) {
        await screenshot(h.page, "failure.png");
        console.error(
          JSON.stringify({
            calls: h.state.calls,
            events: h.state.events,
            pageErrors: h.errors,
            visibleText: await h.page.locator("main").innerText(),
          }),
        );
        throw error;
      } finally {
        await h.context.close();
      }
    },
  );
  await run(
    "TEST-MM-049/050 completion response before final logout clear, failed final clear retry",
    async () => {
      const h = await harness();
      try {
        h.state.completionGate = deferred();
        h.state.logoutFailure = 2;
        h.state.completionUser = googleMember;
        await h.page.goto(`${origin}/login?complete=1`);
        await h.page
          .getByRole("button", { name: "Cancel and sign out" })
          .click();
        await waitFor(() => assert.equal(h.state.logoutCount, 1));
        assert.equal(h.state.calls.includes("session"), false);
        assert.equal(new URL(h.page.url()).pathname, "/login");
        h.state.completionGate.resolve();
        await h.page
          .getByRole("button", { name: "Retry sign-out", exact: true })
          .waitFor();
        await waitFor(() => assert.equal(h.state.logoutCount, 2));
        assert.deepEqual(h.state.events, [
          "logout-1",
          "complete-response",
          "logout-2",
        ]);
        assert.equal(await h.page.getByRole("link").count(), 0);
        assert.equal(
          await h.page
            .getByRole("button", { name: "Login", exact: true })
            .count(),
          0,
        );
        await screenshot(h.page, "final-logout-failed.png");
        await h.page
          .getByRole("button", { name: "Retry sign-out", exact: true })
          .click();
        await h.page.waitForURL(`${origin}/login`);
        assert.equal(
          (await h.context.cookies()).some((c) => c.name === "mm_access"),
          false,
        );
        assert.equal(h.state.logoutCount, 3);
        assert.equal(
          await h.page.getByText(googleMember.user.email).count(),
          0,
        );
        assert.deepEqual(h.errors, []);
      } catch (error) {
        await screenshot(h.page, "failure.png");
        console.error(
          JSON.stringify({
            calls: h.state.calls,
            events: h.state.events,
            pageErrors: h.errors,
            visibleText: await h.page.locator("main").innerText(),
          }),
        );
        throw error;
      } finally {
        await h.context.close();
      }
    },
  );
  await run(
    "TEST-MM-052 Google cancellation and approved redirect destination",
    async () => {
      const h = await harness();
      try {
        await h.page.goto(`${origin}/login?authError=PROVIDER_CANCELLED`);
        await h.page
          .getByText(
            "Google sign-in cancelled. Start again when you are ready.",
          )
          .waitFor();
        assert.equal(new URL(h.page.url()).search, "");
        assert.equal(h.state.calls.length, 0);
        await readyLogin(h.page);
        let redirectFollowed = false;
        await h.page.route("https://unapproved.example.test/**", (route) => {
          redirectFollowed = true;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ url: h.state.authorizationUrl }),
          });
        });
        h.state.googleHttpRedirect = true;
        await h.page
          .getByRole("button", { name: "Sign in with Google" })
          .click();
        await h.page.locator('main [role="alert"]').locator("p").waitFor();
        assert.equal(
          redirectFollowed,
          false,
          "Google form HTTP redirects must be rejected before following destination",
        );
        assert.equal(new URL(h.page.url()).origin, origin);
        h.state.googleHttpRedirect = false;
        h.state.authorizationUrl = "https://unapproved.example.test/";
        await h.page
          .getByRole("button", { name: "Sign in with Google" })
          .click();
        await h.page.locator('main [role="alert"]').locator("p").waitFor();
        assert.equal(new URL(h.page.url()).origin, origin);
        h.state.authorizationUrl =
          "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic";
        await h.page.route("https://accounts.google.com/**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<p>Controlled provider navigation test only</p>",
          }),
        );
        await h.page
          .getByRole("button", { name: "Sign in with Google" })
          .click();
        await h.page.waitForURL("https://accounts.google.com/**");
        assert.deepEqual(h.errors, []);
      } catch (error) {
        await screenshot(h.page, "failure.png");
        console.error(
          JSON.stringify({
            calls: h.state.calls,
            events: h.state.events,
            pageErrors: h.errors,
            visibleText: await h.page.locator("main").innerText(),
          }),
        );
        throw error;
      } finally {
        await h.context.close();
      }
    },
  );
} finally {
  await browser.close();
  if (output)
    await fs.writeFile(
      path.join(output, "browser.json"),
      JSON.stringify(
        {
          scope:
            "FE browser with mocked HTTP/provider; does not prove BE, PG, Google verification or JWT enforcement",
          results,
        },
        null,
        2,
      ),
    );
}
