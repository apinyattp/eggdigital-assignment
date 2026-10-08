// Local production frontend with controlled API replies; no real account or backend access.
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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
const member = {
  user: {
    id: "owner",
    displayName: "Synthetic Owner",
    email: "owner@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
const summary = {
  id: "meeting",
  title: "Synthetic interview",
  candidate: { name: "Synthetic Candidate" },
  position: "Engineer",
  description: null,
  preparationNotes: null,
  startsAt: "2099-10-08T03:00:00Z",
  endsAt: "2099-10-08T04:00:00Z",
  status: "PENDING",
  format: "ONSITE",
  location: "Room",
  joinUrl: null,
  organizer: { id: "owner", displayName: "Synthetic Owner" },
  attendeeCount: 0,
  attendees: [],
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function check(assertion) {
  const end = Date.now() + 7000;
  let last;
  while (Date.now() < end) {
    try {
      await assertion();
      return;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 30));
  }
  throw last;
}
const state = {
  session: member,
  sessionGate: deferred(),
  listGate: deferred(),
  summaryGate: null,
  summaryStatus: 200,
  sessionStatus: 200,
};
const reply = (route, status, body) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  });
await page.route("**/api/v1/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/v1/auth/session") {
    if (state.sessionGate) await state.sessionGate.promise;
    return reply(
      route,
      state.sessionStatus,
      state.sessionStatus === 200
        ? state.session
        : { error: { code: "CANDIDATE_DENIED" } },
    );
  }
  if (url.pathname === "/api/v1/auth/logout") {
    state.session = null;
    return route.fulfill({ status: 204 });
  }
  if (url.pathname === "/api/v1/meetings") {
    if (state.listGate) await state.listGate.promise;
    return reply(route, 200, {
      date: url.searchParams.get("date"),
      timeZone: "Asia/Bangkok",
      referenceTime: "2026-10-08T03:00:00Z",
      snapshot: "synthetic-list",
      groups: {
        upcomingCurrent: { items: [summary], page: 1, pageSize: 10, total: 1 },
        rejectedCancelled: { count: 0, items: [] },
        past: { count: 0, items: [] },
      },
    });
  }
  if (url.pathname.endsWith("/summary")) {
    const status = state.summaryStatus;
    if (state.summaryGate) await state.summaryGate.promise;
    return reply(
      route,
      status,
      status === 200
        ? { meeting: summary }
        : { error: { code: "REQUEST_FAILED" } },
    );
  }
  if (url.pathname.endsWith("/notes/me"))
    return reply(route, 200, { note: null });
  if (url.pathname.endsWith("/feedback"))
    return reply(route, 200, {
      items: [],
      ownFeedbackId: null,
      page: 1,
      pageSize: 50,
      total: 0,
      asOf: "2026-10-08T03:00:00Z",
      snapshot: "synthetic-feedback",
    });
  if (url.pathname === "/api/v1/meetings/meeting")
    return reply(route, 200, {
      meeting: {
        ...summary,
        creatorId: "owner",
        candidate: { ...summary.candidate, email: "candidate@example.test" },
        meetingProvider: null,
        externalMeetingId: null,
        createdAt: "2026-10-07T03:00:00Z",
        updatedAt: "2026-10-08T03:00:00Z",
      },
    });
  failures.push(`Unexpected API request ${url.pathname}`);
  return reply(route, 500, { error: { code: "UNEXPECTED_FIXTURE_REQUEST" } });
});
await page.route("**/api/auth/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/attempt")) return route.fulfill({ status: 204 });
  if (path.endsWith("/csrf"))
    return reply(route, 200, { csrfToken: "synthetic-csrf" });
  if (path.endsWith("/signout"))
    return reply(route, 200, { url: `${origin}/login` });
  if (path.endsWith("/session")) return reply(route, 200, {});
  failures.push(`Unexpected auth request ${path}`);
  return reply(route, 500, {});
});
const loader = page.locator("[data-workspace-loading]");
const navigation = page.getByRole("navigation", {
  name: "Workspace navigation",
});
async function release(name) {
  const pending = state[name];
  state[name] = null;
  pending?.resolve();
}
async function shellIsStable() {
  assert.equal(
    await page.locator("header[data-test-persistent-shell]").count(),
    1,
  );
  assert.equal(await navigation.count(), 1);
}
try {
  await page.goto(`${origin}/dashboard?date=2026-10-08`);
  await page.getByText("Checking your account…", { exact: true }).waitFor();
  await page
    .getByRole("banner")
    .evaluate((header) =>
      header.setAttribute("data-test-persistent-shell", "true"),
    );
  await check(async () =>
    assert.equal(
      await loader
        .locator("div")
        .evaluate((element) => getComputedStyle(element).opacity),
      "1",
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await loader
      .locator("span")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  if (process.env.FE_NAVIGATION_SCREENSHOT)
    await page.screenshot({
      path: process.env.FE_NAVIGATION_SCREENSHOT,
      fullPage: true,
    });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await release("sessionGate");
  await page.getByText("Loading interviews…", { exact: true }).waitFor();
  await shellIsStable();
  await release("listGate");
  await page
    .getByRole("link", { name: "View Synthetic Candidate meeting" })
    .waitFor();
  assert.equal(await loader.count(), 0);
  console.log(
    "PASS delayed identity/list reads use shared content loading; shell persists",
  );

  state.summaryGate = deferred();
  await page
    .getByRole("link", { name: "View Synthetic Candidate meeting" })
    .click();
  await page.getByText("Loading meeting details…", { exact: true }).waitFor();
  await shellIsStable();
  // Leave before the response: an abandoned request must not keep a global flag set.
  await navigation.getByRole("link", { name: "Add New Meeting" }).click();
  await page.getByRole("heading", { name: "Schedule a New Meeting" }).waitFor();
  await release("summaryGate");
  await shellIsStable();
  assert.equal(await loader.count(), 0);
  assert.equal(
    await page.getByRole("heading", { name: "Candidate profile" }).count(),
    0,
  );
  console.log(
    "PASS interrupted data navigation cannot leave stale content or stuck loading",
  );

  await page.goBack();
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
  await shellIsStable();
  await page.goForward();
  await page.getByRole("heading", { name: "Schedule a New Meeting" }).waitFor();
  await shellIsStable();
  assert.equal(await loader.count(), 0);
  console.log("PASS Back/Forward restore pages and retain the same shell");

  state.summaryStatus = 503;
  await page.goBack();
  await page
    .getByRole("button", { name: "Retry loading meeting details" })
    .waitFor();
  assert.equal(await loader.count(), 0);
  await shellIsStable();
  state.summaryStatus = 200;
  await page
    .getByRole("button", { name: "Retry loading meeting details" })
    .click();
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
  assert.equal(await loader.count(), 0);
  console.log("PASS failed data load exits loading and retry recovers");

  await page.getByRole("link", { name: "Edit Meeting", exact: true }).click();
  await page
    .getByRole("heading", { name: "Edit Meeting", exact: true })
    .waitFor();
  await shellIsStable();
  await page.goBack();
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
  state.sessionGate = deferred();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByText("Checking your account…", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Synthetic Candidate", { exact: true }).count(),
    0,
  );
  state.session = {
    ...member,
    user: { ...member.user, id: "other", displayName: "Other Member" },
  };
  state.summaryStatus = 403;
  await release("sessionGate");
  await page
    .getByRole("heading", {
      name: "Meeting not found or you do not have access.",
    })
    .waitFor();
  assert.equal(
    await page.getByText("Synthetic Candidate", { exact: true }).count(),
    0,
  );
  assert.equal(await loader.count(), 0);
  await shellIsStable();
  console.log(
    "PASS account switch hides old protected details and handles new-account denial",
  );

  state.sessionStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page
    .getByText("Unable to verify your access to this meeting.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Synthetic Candidate", { exact: true }).count(),
    0,
  );
  assert.equal(await loader.count(), 0);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await page.waitForURL("**/login");
  assert.equal(await navigation.count(), 0);
  assert.equal(
    await page.getByText("Synthetic Candidate", { exact: true }).count(),
    0,
  );
  console.log(
    "PASS revocation and logout remove protected content; no stuck loader",
  );
  assert.deepEqual(failures, []);
} finally {
  for (const name of ["sessionGate", "listGate", "summaryGate"])
    await release(name);
  await context.close();
  await browser.close();
}
