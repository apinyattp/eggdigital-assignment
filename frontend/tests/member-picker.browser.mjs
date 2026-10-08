// Actual production forms with controlled synthetic API responses, not backend E2E.
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const origin = process.env.FE_TEST_ORIGIN ?? "http://127.0.0.1:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const engines = (process.env.PICKER_BROWSERS ?? "chromium").split(",");
assert.ok(
  engines.length > 0 &&
    engines.every((name) => ["chromium", "webkit"].includes(name)),
);
const members = Array.from({ length: 55 }, (_, index) => ({
  id: `member-${index + 1}`,
  displayName: `Synthetic Member ${String(index + 1).padStart(2, "0")}`,
  email: `member-${index + 1}@example.test`,
}));
const session = {
  user: {
    id: "owner",
    displayName: "Synthetic Owner",
    email: "owner@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
const meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Synthetic interview",
  candidate: { name: "Synthetic Candidate", email: "candidate@example.test" },
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
  createdAt: "2026-10-07T03:00:00Z",
  updatedAt: "2026-10-08T03:00:00Z",
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function check(assertion) {
  const end = Date.now() + 5000;
  let last;
  while (Date.now() < end) {
    try {
      return await assertion();
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw last;
}
const failures = [];
for (const engine of engines) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    ...(engine === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    for (const view of ["create", "edit"]) {
      for (const mode of ["mouse", "touch", "keyboard"]) {
        const name = `${engine} ${view} ${mode}`;
        const context = await browser.newContext(
          mode === "touch"
            ? {
                hasTouch: true,
                isMobile: true,
                viewport: { width: 390, height: 844 },
              }
            : { viewport: { width: 1440, height: 1000 } },
        );
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(15000);
        const errors = [];
        const calls = [];
        const gates = new Map();
        let stage = "setup";
        page.on("pageerror", (error) => errors.push(error.message));
        const reply = (route, status, body) =>
          route.fulfill({
            status,
            contentType: "application/json",
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify(body),
          });
        await context.route("**/*", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) {
            errors.push(`Unexpected external request: ${url.origin}`);
            return route.abort();
          }
          if (!url.pathname.startsWith("/api/")) return route.continue();
          if (request.method() === "GET") {
            if (url.pathname === "/api/v1/auth/session")
              return reply(route, 200, session);
            if (url.pathname === "/api/auth/session")
              return reply(route, 200, { expires: session.expiresAt });
            if (url.pathname === "/api/v1/meetings/meeting")
              return reply(route, 200, { meeting });
            if (url.pathname === "/api/v1/members") {
              const number = Number(url.searchParams.get("page"));
              const query = url.searchParams.get("query");
              if (
                ![1, 2, 3].includes(number) ||
                query !== "Synthetic Member" ||
                url.searchParams.get("pageSize") !== "20"
              ) {
                errors.push("Unexpected member pagination parameters");
                return reply(route, 400, {});
              }
              calls.push(number);
              const gate = gates.get(number);
              if (gate) await gate.promise;
              return reply(route, 200, {
                items: members.slice((number - 1) * 20, number * 20),
                page: number,
                pageSize: 20,
                total: 55,
                totalPages: 3,
              });
            }
          }
          errors.push(
            `Unexpected API request: ${request.method()} ${url.pathname}`,
          );
          return reply(route, 500, {
            error: { code: "UNEXPECTED_FIXTURE_REQUEST" },
          });
        });
        try {
          await page.goto(
            `${origin}${view === "create" ? "/meetings/new" : "/meetings/meeting/edit"}`,
          );
          const search = page.getByRole("combobox", {
            name: "Interview Teams Email",
          });
          const options = page
            .getByRole("listbox", { name: "Company members" })
            .getByRole("option");
          const loadMore = page.getByRole("button", {
            name: "Load more members",
            exact: true,
          });
          const outside = page.getByRole("textbox", {
            name: "Title",
            exact: true,
          });
          await search.fill("Synthetic Member");
          await check(async () => assert.equal(await options.count(), 20));
          await search.evaluate((input) => {
            window.memberPickerEvents = [];
            for (const type of [
              "pointerdown",
              "mousedown",
              "focusin",
              "focusout",
            ])
              input.parentElement.addEventListener(type, (event) => {
                if (window.memberPickerEvents.length >= 40) return;
                window.memberPickerEvents.push({
                  type,
                  tag: event.target.tagName,
                  disabled: Boolean(event.target.disabled),
                  button: event.button,
                  defaultPrevented: event.defaultPrevented,
                  relatedTag: event.relatedTarget?.tagName ?? null,
                  activeTag: document.activeElement?.tagName,
                });
              });
          });
          for (const number of [2, 3]) {
            stage = `activate-page-${number}`;
            const gate = deferred();
            gates.set(number, gate);
            if (mode === "keyboard") {
              await page.keyboard.press("Tab");
              assert.equal(
                await loadMore.count(),
                1,
                "Natural Tab keeps Load more reachable",
              );
              assert.equal(await search.getAttribute("aria-expanded"), "true");
              // Chromium may include the scrollable listbox in native tab order.
              if (
                await page
                  .getByRole("listbox", { name: "Company members" })
                  .evaluate((listbox) => document.activeElement === listbox)
              )
                await page.keyboard.press("Tab");
              assert.equal(
                await loadMore.evaluate(
                  (button) => document.activeElement === button,
                ),
                true,
                "Natural Tab reaches Load more",
              );
              await page.keyboard.press(number === 2 ? "Enter" : "Space");
            } else if (mode === "touch") await loadMore.tap();
            else await loadMore.click();
            await check(() =>
              assert.equal(calls.filter((value) => value === number).length, 1),
            );
            assert.equal(
              await loadMore.isDisabled(),
              true,
              "Native disabled button prevents repeat activation while pending",
            );
            assert.equal(
              await search.evaluate(
                (input) => document.activeElement === input,
              ),
              true,
              "Activation retains input focus without a test-side repair",
            );
            assert.equal(await search.getAttribute("aria-expanded"), "true");
            assert.equal(
              await options.count(),
              (number - 1) * 20,
              "Existing suggestions remain visible while pending",
            );
            if (mode !== "keyboard") {
              stage = `repeat-disabled-page-${number}`;
              const bounds = await loadMore.boundingBox();
              assert.ok(bounds);
              const x = bounds.x + bounds.width / 2;
              const y = bounds.y + bounds.height / 2;
              // A physical repeat on the disabled control must not queue another page.
              if (mode === "touch") await page.touchscreen.tap(x, y);
              else await page.mouse.click(x, y);
              assert.equal(calls.filter((value) => value === number).length, 1);
              assert.equal(
                await options.count(),
                (number - 1) * 20,
                "Pending suggestions survive repeated disabled pointer activation",
              );
            }
            stage = `settle-page-${number}`;
            // Hold the reply through an actual rendering interval, not a synchronous mock.
            await page.waitForTimeout(250);
            assert.equal(await search.getAttribute("aria-expanded"), "true");
            gate.resolve();
            await check(async () =>
              assert.equal(await options.count(), number === 2 ? 40 : 55),
            );
            assert.deepEqual(
              await options.locator("strong").allTextContents(),
              members
                .slice(0, number === 2 ? 40 : 55)
                .map((member) => member.displayName),
            );
          }
          assert.deepEqual(
            calls,
            [1, 2, 3],
            "No duplicate or skipped page request",
          );
          assert.equal(
            await loadMore.count(),
            0,
            "Final partial page removes Load more",
          );
          stage = "keyboard-selection";
          await page.keyboard.press("Escape");
          assert.equal(await search.getAttribute("aria-expanded"), "false");
          await page.keyboard.press("ArrowDown");
          assert.equal(await search.getAttribute("aria-expanded"), "true");
          await page.keyboard.press("Enter");
          await page
            .getByRole("button", {
              name: `${view === "create" ? "Remove" : "Remove added"} Synthetic Member 01`,
              exact: true,
            })
            .waitFor();
          assert.equal(await search.inputValue(), "");
          // Closing by real outside blur during a pending reply must not reopen it.
          stage = "outside-blur";
          await search.fill("Synthetic Member");
          await check(async () => assert.equal(await options.count(), 19));
          const outsideGate = deferred();
          gates.set(2, outsideGate);
          await loadMore.click();
          await check(() =>
            assert.equal(calls.filter((value) => value === 2).length, 2),
          );
          await outside.click();
          assert.equal(await search.getAttribute("aria-expanded"), "false");
          outsideGate.resolve();
          await check(async () =>
            assert.equal(await search.getAttribute("aria-busy"), "false"),
          );
          assert.equal(
            await search.getAttribute("aria-expanded"),
            "false",
            "Settled response must not reopen after outside blur",
          );
          assert.deepEqual(errors, []);
          console.log(
            `PASS ${name}: delayed 20→40→55, focus, selection, keyboard and outside blur`,
          );
        } catch (error) {
          failures.push(name);
          console.error(`FAIL ${name}: ${error.message}`);
          const state = await page
            .evaluate(() => {
              const input = document.querySelector(
                '[role="combobox"][name="interview-team-search"]',
              );
              const wrapper = input?.parentElement;
              const list = wrapper?.querySelector('[role="listbox"]');
              const button = [
                ...(wrapper?.querySelectorAll("button") ?? []),
              ].find((node) => node.textContent.trim() === "Load more members");
              return {
                active: {
                  tag: document.activeElement?.tagName,
                  role: document.activeElement?.getAttribute("role"),
                },
                expanded: input?.getAttribute("aria-expanded"),
                busy: input?.getAttribute("aria-busy"),
                optionsHidden: list?.hidden,
                optionsCount: list?.querySelectorAll('[role="option"]').length,
                loadMoreDisabled: button ? button.disabled : null,
                events: window.memberPickerEvents ?? [],
              };
            })
            .catch(() => ({ unavailable: true }));
          console.error(JSON.stringify({ stage, calls, state, errors }));
        } finally {
          for (const gate of gates.values()) gate.resolve();
          await context.unrouteAll({ behavior: "wait" });
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
}
assert.deepEqual(failures, [], "Member picker browser regressions failed");
