// Production UI with synthetic auth only. Mobile emulation does not reproduce iOS keyboards.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
const origin = process.env.FE_TEST_ORIGIN ?? "http://127.0.0.1:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const engines = (process.env.PICKER_BROWSERS ?? "chromium").split(",");
assert.ok(
  engines.length &&
    engines.every((engine) => ["chromium", "webkit"].includes(engine)),
);
const results = [];
for (const engine of engines) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    ...(engine === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    for (const variant of ["fresh", "filled", "short-filled", "mouse-filled"]) {
      const context = await browser.newContext({
        viewport: {
          width: 390,
          height: variant === "short-filled" ? 500 : 844,
        },
        isMobile: variant !== "mouse-filled",
        hasTouch: variant !== "mouse-filled",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.setDefaultNavigationTimeout(15000);
      const errors = [];
      const result = { engine, variant, actions: [], status: "failed" };
      page.on("pageerror", (error) => errors.push(error.message));
      await context.addInitScript(() => {
        const original = Date.prototype.toLocaleDateString;
        window.pickerFormats = 0;
        Date.prototype.toLocaleDateString = function (...args) {
          window.pickerFormats++;
          return Reflect.apply(original, this, args);
        };
        window.pickerEvents = [];
        for (const type of ["focusin", "focusout", "scroll", "resize"])
          addEventListener(
            type,
            (event) => {
              if (window.pickerEvents.length < 300)
                window.pickerEvents.push({
                  type,
                  tag: event.target?.tagName,
                  id: event.target?.id,
                  y: scrollY,
                });
            },
            true,
          );
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          errors.push("Unexpected external request");
          return route.abort();
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        let body;
        if (
          route.request().method() === "GET" &&
          url.pathname === "/api/v1/auth/session"
        )
          body = {
            user: {
              id: "owner",
              displayName: "Synthetic Owner",
              email: "owner@example.test",
              membership: "member",
            },
            expiresAt: "2099-01-01T00:00:00Z",
          };
        else if (
          route.request().method() === "GET" &&
          url.pathname === "/api/auth/session"
        )
          body = { expires: "2099-01-01T00:00:00Z" };
        else {
          errors.push(
            `Unexpected API request ${route.request().method()} ${url.pathname}`,
          );
          return route.abort();
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify(body),
        });
      });
      const snapshot = async (label) => {
        const data = await page.evaluate(() => {
          const dialog = document.querySelector("dialog[open]");
          const rect = dialog?.getBoundingClientRect();
          const active = document.activeElement;
          return {
            formats: window.pickerFormats,
            scrollY,
            viewport: {
              height: innerHeight,
              scale: visualViewport?.scale,
              offsetTop: visualViewport?.offsetTop,
            },
            active: {
              tag: active?.tagName,
              id: active?.id,
              role: active?.getAttribute("role"),
              fontSize: active ? getComputedStyle(active).fontSize : null,
            },
            dialog: rect
              ? {
                  top: rect.top,
                  bottom: rect.bottom,
                  height: rect.height,
                  scrollTop: dialog.scrollTop,
                }
              : null,
          };
        });
        result.actions.push({ label, ...data });
        return data;
      };
      // Record intentional actionability scrolling separately from opening/closing.
      const tap = async (locator) => {
        await locator.scrollIntoViewIfNeeded();
        if (variant === "mouse-filled") await locator.click();
        else await locator.tap();
      };
      const assertKeyboardRing = async (locator) => {
        const visible = await locator.evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            element === document.activeElement &&
            style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) > 0
          );
        });
        assert.equal(
          visible,
          true,
          "Keyboard focus must retain its visible outline",
        );
      };
      const formatDeltas = [];
      const fields = [
        ["Candidate Name", "Synthetic Candidate"],
        ["Candidate Email", "candidate@example.test"],
        ["Position", "Engineer"],
        ["Title", "Synthetic mobile interview"],
        ["Description", "Synthetic description typed before choosing dates"],
      ];
      try {
        await page.goto(`${origin}/meetings/new`);
        const title = page.getByRole("textbox", { name: "Title", exact: true });
        await title.waitFor();
        if (variant !== "fresh") {
          for (const [name, value] of fields) {
            const field = page.getByRole("textbox", { name, exact: true });
            await tap(field);
            await field.fill(value);
            await snapshot(`filled ${name}`);
          }
        }
        const start = page.locator("#startDate");
        for (let cycle = 0; cycle < 3; cycle++) {
          const previous = await start.inputValue();
          await start.scrollIntoViewIfNeeded();
          await snapshot(`date ${cycle} before open after intentional scroll`);
          await tap(start);
          const dialog = page.getByRole("dialog", { name: "Choose date" });
          await dialog.waitFor();
          await snapshot(`date ${cycle} open`);
          // Move to a wholly available month; measure an interior day so ArrowRight
          // cannot legitimately rebuild the grid at a month boundary.
          await tap(
            dialog.getByRole("button", { name: "Next month", exact: true }),
          );
          const monthName = await dialog
            .getByRole("button", { name: "Select month", exact: true })
            .textContent();
          const displayedYear = await dialog
            .getByRole("button", { name: "Select year", exact: true })
            .textContent();
          const monthNumber =
            [
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ].indexOf(monthName === "Sept" ? "Sep" : monthName) + 1;
          assert.ok(monthNumber > 0);
          const chosen = `${displayedYear}-${String(monthNumber).padStart(2, "0")}-0${cycle + 5}`;
          const choice = dialog.locator(`button[data-date="${chosen}"]`);
          await tap(choice);
          const before = await snapshot(`date ${cycle} selected`);
          await page.keyboard.press("ArrowRight");
          const after = await snapshot(`date ${cycle} keyboard focus moved`);
          formatDeltas.push(after.formats - before.formats);
          assert.equal(
            await dialog
              .locator('button[aria-pressed="true"]')
              .getAttribute("data-date"),
            chosen,
          );
          if (cycle === 1) {
            await tap(
              dialog.getByRole("button", { name: "Cancel", exact: true }),
            );
            assert.equal(await start.inputValue(), previous);
          } else {
            await tap(
              dialog.getByRole("button", { name: "Apply", exact: true }),
            );
            assert.equal(await start.inputValue(), chosen);
          }
          await dialog.waitFor({ state: "hidden" });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          assert.equal(
            await start.evaluate((input) => input === document.activeElement),
            true,
          );
          await snapshot(`date ${cycle} closed`);
        }
        await tap(start);
        const calendar = page.getByRole("dialog", { name: "Choose date" });
        await tap(
          calendar.getByRole("button", { name: "Select year", exact: true }),
        );
        const year = calendar.locator('button[aria-pressed="true"]');
        await tap(year);
        const month = calendar.locator('button[aria-pressed="true"]');
        await tap(month);
        assert.equal(await calendar.locator("button[data-date]").count(), 42);
        await tap(
          calendar.getByRole("button", { name: "Cancel", exact: true }),
        );
        // Keyboard opening and Escape cancel keep committed value and visible trigger focus.
        for (const key of ["Enter", "Space"]) {
          const saved = await start.inputValue();
          await start.press(key);
          await calendar.waitFor();
          await assertKeyboardRing(calendar.locator("button[data-date]:focus"));
          await page.keyboard.press("Escape");
          await calendar.waitFor({ state: "hidden" });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          assert.equal(await start.inputValue(), saved);
          assert.equal(
            await start.evaluate((input) => input === document.activeElement),
            true,
          );
          assert.equal(await start.isVisible(), true);
        }
        const end = page.locator("#endDate");
        await tap(end);
        const endChoice = calendar
          .locator("button[data-date]:not([disabled])")
          .nth(1);
        const selectedEnd = await endChoice.getAttribute("data-date");
        await tap(endChoice);
        await tap(calendar.getByRole("button", { name: "Apply", exact: true }));
        assert.equal(await end.inputValue(), selectedEnd);
        await tap(start);
        const later = calendar
          .locator(`button[data-date]:not([disabled])`)
          .filter({ hasText: /./ });
        const laterDates = await later.evaluateAll((buttons) =>
          buttons.map((button) => button.dataset.date),
        );
        const laterDate = laterDates.find((date) => date > selectedEnd);
        assert.ok(laterDate);
        await tap(calendar.locator(`button[data-date="${laterDate}"]`));
        await tap(calendar.getByRole("button", { name: "Apply", exact: true }));
        assert.equal(await start.inputValue(), laterDate);
        assert.equal(await end.inputValue(), "");
        const time = page.locator("#meeting-time-range");
        const initial = await time.textContent();
        for (const action of ["Cancel", "Done"]) {
          await tap(time);
          const dialog = page.getByRole("dialog");
          const hour = dialog.getByRole("spinbutton", {
            name: "Hour",
            exact: true,
          });
          assert.equal(
            await hour.evaluate((element) => getComputedStyle(element).outlineStyle),
            "none",
            "A touch or mouse opening must not leave purple wheel-edge strokes",
          );
          if (process.env.PICKER_SCREENSHOT_DIR && variant === "filled" && action === "Cancel") {
            await page.waitForTimeout(350);
            await page.screenshot({ path: `${process.env.PICKER_SCREENSHOT_DIR}/${engine}-wheel-pointer.png` });
          }
          await hour.press("ArrowDown");
          await assertKeyboardRing(hour);
          if (process.env.PICKER_SCREENSHOT_DIR && variant === "filled" && action === "Cancel") {
            await page.screenshot({ path: `${process.env.PICKER_SCREENSHOT_DIR}/${engine}-wheel-keyboard.png` });
          }
          const minute = dialog.getByRole("spinbutton", {
            name: "Minute",
            exact: true,
          });
          await tap(minute);
          assert.equal(
            await minute.evaluate((element) => getComputedStyle(element).outlineStyle),
            "none",
            "Returning to pointer input suppresses only the wheel outline",
          );
          await minute.press("End");
          await assertKeyboardRing(minute);
          await snapshot(`time draft before ${action}`);
          await tap(dialog.getByRole("button", { name: action, exact: true }));
          await dialog.waitFor({ state: "hidden" });
          if (action === "Cancel")
            assert.equal(await time.textContent(), initial);
          else assert.equal((await time.textContent()).trim(), "10:59 – 10:00");
          await snapshot(`time ${action} closed`);
        }
        await tap(time);
        const reopened = page.getByRole("dialog");
        assert.equal(
          await reopened
            .getByRole("spinbutton", { name: "Hour", exact: true })
            .getAttribute("aria-valuenow"),
          "10",
        );
        assert.equal(
          await reopened
            .getByRole("spinbutton", { name: "Minute", exact: true })
            .getAttribute("aria-valuenow"),
          "59",
        );
        await tap(reopened.getByRole("tab", { name: /End time/ }));
        assert.equal(
          await reopened
            .getByRole("spinbutton", { name: "Minute", exact: true })
            .getAttribute("aria-valuenow"),
          "0",
        );
        await tap(
          reopened.getByRole("button", {
            name: "Close without saving",
            exact: true,
          }),
        );
        if (variant !== "fresh")
          for (const [name, value] of fields)
            assert.equal(
              await page
                .getByRole("textbox", { name, exact: true })
                .inputValue(),
              value,
            );
        assert.deepEqual(errors, []);
        result.formatDeltas = formatDeltas;
        result.events = await page.evaluate(() => window.pickerEvents);
        assert.ok(
          formatDeltas.every((count) => count === 0),
          `Focus-only date changes reformatted labels: ${formatDeltas.join(",")}`,
        );
        result.status = "passed";
      } catch (error) {
        result.error = error.message;
      } finally {
        results.push(result);
        await context.close();
      }
      console.log(
        `${result.status === "passed" ? "PASS" : "FAIL"} ${engine} ${variant}${result.error ? `: ${result.error}` : ""}`,
      );
    }
  } finally {
    await browser.close();
  }
}
if (process.env.PICKER_EVIDENCE_PATH)
  await writeFile(
    process.env.PICKER_EVIDENCE_PATH,
    JSON.stringify(results, null, 2),
  );
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
