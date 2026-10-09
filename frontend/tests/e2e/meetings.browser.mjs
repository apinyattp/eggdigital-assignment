import assert from "node:assert/strict";
import { runSuite, login, check, chooseDate } from "./helpers.mjs";
import { inspectFixture } from "./fixture.mjs";

async function detail(page, origin, meeting) {
  await page.goto(`${origin}/meetings/${meeting.id}`);
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
}
async function fillMeeting(page, fixture, title, format = "ONSITE") {
  await page
    .getByRole("textbox", { name: "Candidate Name", exact: true })
    .fill("E2E Created Candidate");
  await page
    .getByRole("textbox", { name: "Candidate Email", exact: true })
    .fill("created-candidate@example.test");
  await page
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("Engineer");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByLabel("Description", { exact: true }).fill("E2E description");
  await chooseDate(page, "Start date", fixture.date);
  await chooseDate(page, "End date", fixture.date);
  await page.getByLabel("Meeting type", { exact: true }).selectOption(format);
  if (format === "ONLINE")
    await page
      .getByRole("textbox", { name: "Meeting link", exact: true })
      .fill("https://meet.example.test/e2e");
  else
    await page
      .getByLabel("Location (optional)", { exact: true })
      .fill("E2E interview room");
  await page
    .getByRole("combobox", { name: "Interview Teams Email" })
    .fill(fixture.accounts.attendee.email);
  await page
    .getByRole("option")
    .filter({ hasText: fixture.accounts.attendee.email })
    .click();
  await page
    .getByLabel("Preparation Notes", { exact: true })
    .fill("E2E preparation separate from private notes");
}
async function saveCreated(page) {
  await page.getByRole("button", { name: "Save Meeting", exact: true }).click();
  await page.waitForURL(/\/meetings\/[0-9a-f-]+$/);
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
  return new URL(page.url()).pathname.split("/").pop();
}

await runSuite("meetings", async ({ run }) => {
  await run("E2E-LIST-01", async ({ page, fixture, origin }) => {
    await login(page, fixture.accounts.owner);
    await page.goto(`${origin}/dashboard?date=${fixture.date}`);
    const upcoming = page.locator('[data-section="upcomingCurrent"]');
    await check(async () =>
      assert.equal(
        await upcoming.getByRole("link", { name: /^View .* meeting$/ }).count(),
        10,
      ),
    );
    const renderedIds = () =>
      upcoming
        .getByRole("link", { name: /^View .* meeting$/ })
        .evaluateAll((links) =>
          links.map((link) => new URL(link.href).pathname.split("/").pop()),
        );
    assert.deepEqual(await renderedIds(), fixture.listMeetingIds.slice(0, 10));
    const secondPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/v1/meetings" &&
        url.searchParams.get("page") === "2"
      );
    });
    await upcoming
      .getByRole("button", { name: "Load more", exact: true })
      .click();
    const payload = await (await secondPage).json();
    assert.equal(payload.group.page, 2);
    assert.equal(payload.group.items.length, 2);
    assert.equal(payload.group.total, 12);
    assert.equal(payload.group.totalPages, 2);
    await check(async () =>
      assert.equal(
        await upcoming.getByRole("link", { name: /^View .* meeting$/ }).count(),
        12,
      ),
    );
    const completeIds = await renderedIds();
    assert.deepEqual(completeIds, fixture.listMeetingIds);
    assert.equal(new Set(completeIds).size, fixture.listMeetingIds.length);
    assert.deepEqual(
      payload.group.items.map((item) => item.id),
      fixture.listMeetingIds.slice(10),
    );
    assert.equal(
      await upcoming
        .getByRole("button", { name: "Load more", exact: true })
        .count(),
      0,
    );
    const emptyDate = new Date(`${fixture.date}T12:00:00Z`);
    emptyDate.setUTCDate(emptyDate.getUTCDate() + 10);
    await page.goto(
      `${origin}/dashboard?date=${emptyDate.toISOString().slice(0, 10)}`,
    );
    await page
      .getByText("No meetings are available for the selected date.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByRole("link", { name: /^View .* meeting$/ }).count(),
      0,
    );
  });

  await run(
    "E2E-MEMBER-01",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await page.goto(`${origin}/meetings/new`);
      const search = page.getByRole("combobox", {
        name: "Interview Teams Email",
      });
      await search.fill("E2E Team");
      await check(async () =>
        assert.equal(
          await page.getByRole("listbox").getByRole("option").count(),
          20,
        ),
      );
      let secondPageRequests = 0;
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.pathname === "/api/v1/members" &&
          url.searchParams.get("page") === "2"
        )
          secondPageRequests++;
      });
      await page.getByRole("button", { name: "Load more members" }).click();
      try {
        await check(async () =>
          assert.equal(
            await page.getByRole("listbox").getByRole("option").count(),
            40,
          ),
        );
      } catch (error) {
        const focus = await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          id: document.activeElement?.id,
        }));
        error.message +=
          "\nMember pagination state: " +
          JSON.stringify({
            secondPageRequests,
            expanded: await search.getAttribute("aria-expanded"),
            focus,
          });
        throw error;
      }
      await page.getByRole("button", { name: "Load more members" }).click();
      await check(async () =>
        assert.equal(
          await page.getByRole("listbox").getByRole("option").count(),
          55,
        ),
      );
      assert.equal(
        await page.getByRole("button", { name: "Load more members" }).count(),
        0,
      );
      const memberOptions = await page
        .getByRole("listbox")
        .getByRole("option")
        .allTextContents();
      assert.equal(new Set(memberOptions).size, 55);
      await search.fill(fixture.accounts.attendee.email);
      const option = page
        .getByRole("option")
        .filter({ hasText: fixture.accounts.attendee.email });
      await option.click();
      await page
        .getByRole("button", {
          name: `Remove ${fixture.accounts.attendee.displayName}`,
        })
        .waitFor();
      await search.fill("no-such-member-e2e");
      await page
        .getByText("No available members found. Try another name or email.")
        .waitFor();
      await search.fill("");
      assert.equal(
        await page.getByRole("listbox").getByRole("option").count(),
        0,
      );
      await page
        .getByRole("button", {
          name: `Remove ${fixture.accounts.attendee.displayName}`,
        })
        .click();
      assert.equal(
        await page
          .getByRole("button", {
            name: `Remove ${fixture.accounts.attendee.displayName}`,
          })
          .count(),
        0,
      );
    },
    { tags: ["@critical"] },
  );

  for (const format of ["ONSITE", "ONLINE"]) {
    await run(
      `E2E-CREATE-${format}`,
      async ({ page, fixture, origin }) => {
        await login(page, fixture.accounts.owner);
        await page.goto(`${origin}/meetings/new`);
        await page
          .getByRole("button", { name: "Save Meeting", exact: true })
          .click();
        await page.getByText("This field is required.").first().waitFor();
        await fillMeeting(page, fixture, `E2E ${format} created`, format);
        if (format === "ONLINE") {
          await page
            .getByRole("textbox", { name: "Meeting link", exact: true })
            .fill("http://insecure.example.test");
          await page
            .getByRole("button", { name: "Save Meeting", exact: true })
            .click();
          await page.getByText("Enter a valid HTTPS meeting link.").waitFor();
          await page
            .getByRole("textbox", { name: "Meeting link", exact: true })
            .fill("https://meet.example.test/e2e");
        }
        const id = await saveCreated(page);
        const snapshot = await inspectFixture();
        const saved = snapshot.meetings.find((meeting) => meeting.id === id);
        assert.equal(saved.title, `E2E ${format} created`);
        assert.equal(saved.format, format);
        assert.equal(saved.creatorId, fixture.accounts.owner.id);
        assert.equal(saved.candidateName, "E2E Created Candidate");
        assert.equal(saved.candidateEmail, "created-candidate@example.test");
        assert.equal(
          saved.joinUrl,
          format === "ONLINE" ? "https://meet.example.test/e2e" : null,
        );
        assert.deepEqual(
          snapshot.attendees
            .filter((row) => row.meetingId === id)
            .map((row) => row.memberId),
          [fixture.accounts.attendee.id],
        );
        await page.reload();
        await page
          .getByRole("heading", { name: "Candidate profile" })
          .waitFor();
        await page
          .getByText("E2E Created Candidate", { exact: true })
          .waitFor();
        if (format === "ONLINE")
          assert.equal(
            await page
              .getByRole("link", { name: "Join Meeting" })
              .getAttribute("href"),
            "https://meet.example.test/e2e",
          );
      },
      { tags: ["@critical"] },
    );
  }

  await run(
    "E2E-CREATE-PENDING",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await page.goto(`${origin}/meetings/new`);
      await fillMeeting(page, fixture, "E2E pending create");
      const before = await inspectFixture();
      const form = page.locator("form");
      const formValues = () =>
        form
          .locator("input, textarea, select")
          .evaluateAll((fields) =>
            fields.map((field) => ({ id: field.id, value: field.value })),
          );
      const originalValues = await formValues();
      const posts = [];
      const routeErrors = [];
      const routeTasks = [];
      let originalBody;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const isCreate = (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/meetings";
      const observe = (request) => {
        if (isCreate(request)) posts.push(request);
      };
      const pattern = "**/api/v1/meetings";
      const handler = (route) => {
        const task = (async () => {
          try {
            if (isCreate(route.request()) && originalBody === undefined) {
              originalBody = route.request().postData();
              await gate;
            }
            // The real first POST is forwarded unchanged only after assertions.
            await route.continue();
          } catch (error) {
            routeErrors.push(error);
            await route.abort().catch(() => {});
          }
        })();
        routeTasks.push(task);
        return task;
      };
      page.on("request", observe);
      await page.route(pattern, handler);
      try {
        // Natural keyboard traversal reaches the enabled submit button before
        // saving. Once locked, native disabled controls cannot be focused again.
        await page
          .getByLabel("Preparation Notes", { exact: true })
          .press("Tab");
        const save = page.getByRole("button", {
          name: "Save Meeting",
          exact: true,
        });
        const saveFocused = () =>
          save.evaluate((button) => button === document.activeElement);
        for (let tab = 1; tab < 6 && !(await saveFocused()); tab++)
          await page.keyboard.press("Tab");
        assert.equal(await saveFocused(), true, "Native Tab reaches Save");
        await page.keyboard.press("Enter");
        const pending = page.getByRole("button", {
          name: "Saving…",
          exact: true,
        });
        await pending.waitFor();
        await check(async () => {
          assert.equal(posts.length, 1);
          assert.equal(typeof originalBody, "string");
          assert.equal(await pending.isDisabled(), true);
          assert.equal(await form.getAttribute("aria-busy"), "true");
        });
        const payload = JSON.parse(originalBody);
        assert.match(payload.requestId, /^[0-9a-f-]{36}$/);
        assert.equal(payload.title, "E2E pending create");
        assert.deepEqual(payload.attendeeMemberIds, [
          fixture.accounts.attendee.id,
        ]);
        // Raw physical input does not auto-wait for enabled state or bypass the
        // browser's disabled semantics as force-click/dispatchEvent would.
        for (let repeat = 0; repeat < 2; repeat++) {
          await pending.scrollIntoViewIfNeeded();
          const box = await pending.boundingBox();
          assert.ok(box, "Pending submit remains visible");
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          await page.mouse.click(x, y);
          await page.touchscreen.tap(x, y);
          await page.keyboard.press("Enter");
          await page.keyboard.press("Space");
        }
        assert.equal(await pending.isDisabled(), true);
        assert.equal(await form.getAttribute("aria-busy"), "true");
        assert.deepEqual(await formValues(), originalValues);
        const held = await inspectFixture();
        assert.deepEqual(
          held.meetings,
          before.meetings,
          "No meeting write before gate release",
        );
        assert.deepEqual(
          held.attendees,
          before.attendees,
          "No attendee write before gate release",
        );
        assert.equal(
          posts.length,
          1,
          "Frontend suppresses repeated pending submissions",
        );
        assert.deepEqual(
          posts.map((request) => request.postData()),
          [originalBody],
        );
        assert.deepEqual(routeErrors, []);
        const response = page.waitForResponse((response) =>
          isCreate(response.request()),
        );
        release();
        const savedResponse = await response;
        assert.equal(savedResponse.ok(), true);
        assert.equal(savedResponse.request().postData(), originalBody);
        await page.waitForURL(/\/meetings\/[0-9a-f-]+$/);
        await page
          .getByRole("heading", { name: "Candidate profile" })
          .waitFor();
        const id = new URL(page.url()).pathname.split("/").pop();
        const saved = await inspectFixture();
        assert.equal(saved.meetings.length, before.meetings.length + 1);
        const matches = saved.meetings.filter(
          (meeting) => meeting.requestId === payload.requestId,
        );
        assert.equal(matches.length, 1);
        assert.equal(matches[0].id, id);
        assert.equal(matches[0].creatorId, fixture.accounts.owner.id);
        for (const key of [
          "title",
          "format",
          "candidateName",
          "candidateEmail",
          "status",
        ])
          assert.equal(matches[0][key], payload[key]);
        for (const key of ["startsAt", "endsAt"])
          assert.equal(Date.parse(matches[0][key]), Date.parse(payload[key]));
        assert.deepEqual(
          saved.attendees.filter((row) => row.meetingId === id),
          [
            {
              meetingId: id,
              memberId: fixture.accounts.attendee.id,
              email: fixture.accounts.attendee.email,
            },
          ],
        );
        assert.equal(saved.attendees.length, before.attendees.length + 1);
        await page.reload();
        await page
          .getByRole("heading", { name: "Candidate profile" })
          .waitFor();
        assert.equal(posts.length, 1);
        const reloaded = await inspectFixture();
        assert.deepEqual(reloaded.meetings, saved.meetings);
        assert.deepEqual(reloaded.attendees, saved.attendees);
        assert.deepEqual(routeErrors, []);
      } finally {
        release();
        await page.unroute(pattern, handler);
        await Promise.all(routeTasks);
        page.off("request", observe);
        // runSuite closes this owned context even if an assertion failed.
      }
    },
    { tags: ["@critical"], hasTouch: true },
    "real local stack; first create POST held before forwarding; native repeated input",
  );

  await run(
    "E2E-CREATE-RECOVERY",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await page.goto(`${origin}/meetings/new`);
      await fillMeeting(page, fixture, "E2E lost create response");
      let dropped = false;
      // Inject only response loss after the real backend commits. Recovery uses
      // the real idempotency request; success is never fabricated by this test.
      await page.route("**/api/v1/meetings", async (route) => {
        if (route.request().method() === "POST" && !dropped) {
          dropped = true;
          const response = await route.fetch();
          assert.ok(
            response.ok(),
            "Real creation must commit before response loss",
          );
          return route.abort("connectionclosed");
        }
        return route.continue();
      });
      await page
        .getByRole("button", { name: "Save Meeting", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Check save result again" })
        .waitFor();
      assert.equal(
        (await inspectFixture()).meetings.filter(
          (meeting) => meeting.title === "E2E lost create response",
        ).length,
        1,
      );
      await page
        .getByRole("button", { name: "Check save result again" })
        .click();
      await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
      assert.equal(
        (await inspectFixture()).meetings.filter(
          (meeting) => meeting.title === "E2E lost create response",
        ).length,
        1,
      );
    },
    {},
    "real local stack with injected loss of committed create response",
  );

  await run(
    "E2E-EDIT-01",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await detail(page, origin, fixture.meetings.onsite);
      await page
        .getByRole("link", { name: "Edit Meeting", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("E2E edited title");
      await page
        .getByLabel("Status", { exact: true })
        .selectOption("CONFIRMED");
      await page
        .getByLabel("Preparation Notes", { exact: true })
        .fill("E2E edited preparation");
      await page
        .getByRole("combobox", { name: "Interview Teams Email" })
        .fill(fixture.accounts.outsider.email);
      await page
        .getByRole("option")
        .filter({ hasText: fixture.accounts.outsider.email })
        .click();
      await page
        .getByRole("button", {
          name: `Remove ${fixture.accounts.attendee.displayName}`,
        })
        .click();
      await page
        .getByRole("button", { name: "Save Meeting", exact: true })
        .click();
      await check(async () =>
        assert.equal(
          (await inspectFixture()).meetings.find(
            (meeting) => meeting.id === fixture.meetings.onsite.id,
          ).title,
          "E2E edited title",
        ),
      );
      const team = (await inspectFixture()).attendees.filter(
        (row) => row.meetingId === fixture.meetings.onsite.id,
      );
      assert.ok(
        team.some((row) => row.memberId === fixture.accounts.outsider.id),
      );
      assert.equal(
        team.some((row) => row.memberId === fixture.accounts.attendee.id),
        false,
      );
      assert.equal(
        (await inspectFixture()).meetings.find(
          (meeting) => meeting.id === fixture.meetings.onsite.id,
        ).status,
        "CONFIRMED",
      );
      await page.reload();
      await check(async () =>
        assert.equal(
          await page
            .getByRole("textbox", { name: "Title", exact: true })
            .inputValue(),
          "E2E edited title",
        ),
      );
      assert.equal(
        await page
          .getByLabel("Preparation Notes", { exact: true })
          .inputValue(),
        "E2E edited preparation",
      );
    },
    { tags: ["@critical"] },
  );

  await run("E2E-CANCEL-01", async ({ page, fixture, origin }) => {
    await login(page, fixture.accounts.owner);
    await detail(page, origin, fixture.meetings.onsite);
    await page
      .getByRole("button", { name: "Cancel Meeting", exact: true })
      .click();
    await page.getByRole("button", { name: "Keep Meeting" }).click();
    assert.equal(
      (await inspectFixture()).meetings.find(
        (meeting) => meeting.id === fixture.meetings.onsite.id,
      ).status,
      "PENDING",
    );
    await page
      .getByRole("button", { name: "Cancel Meeting", exact: true })
      .click();
    await page.getByRole("button", { name: "Confirm Cancel" }).click();
    await check(async () =>
      assert.equal(
        (await inspectFixture()).meetings.find(
          (meeting) => meeting.id === fixture.meetings.onsite.id,
        ).status,
        "CANCELLED",
      ),
    );
    await check(async () =>
      assert.equal(await page.getByRole("dialog").count(), 0),
    );
    await page.reload();
    await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Cancel Meeting", exact: true })
        .count(),
      0,
    );
  });

  await run(
    "E2E-DELETE-01",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await detail(page, origin, fixture.meetings.onsite);
      await page
        .getByRole("button", { name: "Add Feedback", exact: true })
        .click();
      const feedback = page.getByRole("dialog", { name: "Add Feedback" });
      await feedback
        .getByLabel("Interview feedback", { exact: true })
        .fill("E2E feedback deleted with its meeting");
      await feedback.getByRole("button", { name: "Save Feedback" }).click();
      await page
        .getByText("E2E feedback deleted with its meeting", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Delete Meeting", exact: true })
        .click();
      await page.getByRole("button", { name: "Keep Meeting" }).click();
      assert.ok(
        (await inspectFixture()).meetings.some(
          (meeting) => meeting.id === fixture.meetings.onsite.id,
        ),
      );
      await page
        .getByRole("button", { name: "Delete Meeting", exact: true })
        .click();
      await page.getByRole("button", { name: "Confirm Delete" }).click();
      await page.waitForURL("**/dashboard*");
      const after = await inspectFixture();
      assert.equal(
        after.meetings.some(
          (meeting) => meeting.id === fixture.meetings.onsite.id,
        ),
        false,
      );
      assert.equal(
        after.attendees.some(
          (row) => row.meetingId === fixture.meetings.onsite.id,
        ),
        false,
      );
      assert.equal(
        after.notes.some(
          (note) => note.meetingId === fixture.meetings.onsite.id,
        ),
        false,
      );
      assert.equal(
        after.feedback.some(
          (row) => row.meetingId === fixture.meetings.onsite.id,
        ),
        false,
      );
      await page.goto(`${origin}/meetings/${fixture.meetings.onsite.id}`);
      await page
        .getByRole("heading", {
          name: "Meeting not found or you do not have access.",
        })
        .waitFor();
    },
    { tags: ["@critical"] },
  );

  await run("E2E-FEEDBACK-01", async ({ page, fixture, origin }) => {
    await login(page, fixture.accounts.owner);
    await detail(page, origin, fixture.meetings.onsite);
    await page
      .getByRole("button", { name: "Add Feedback", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Add Feedback" });
    await dialog
      .getByLabel("Interview feedback", { exact: true })
      .fill("E2E original feedback");
    const createdRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/v1/meetings/${fixture.meetings.onsite.id}/feedback`,
    );
    await dialog.getByRole("button", { name: "Save Feedback" }).click();
    const original = (await createdRequest).postDataJSON();
    await page.getByText("E2E original feedback", { exact: true }).waitFor();
    const replay = await page.evaluate(
      async ({ id, body }) => {
        const response = await fetch(`/api/v1/meetings/${id}/feedback`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "MeetingManager",
          },
          body: JSON.stringify(body),
        });
        return response.status;
      },
      { id: fixture.meetings.onsite.id, body: original },
    );
    assert.equal(replay, 200);
    assert.equal(
      (await inspectFixture()).feedback.filter(
        (row) =>
          row.meetingId === fixture.meetings.onsite.id &&
          row.authorKey === `member:${fixture.accounts.owner.id}`,
      ).length,
      1,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Add Feedback", exact: true })
        .isEnabled(),
      false,
    );
    await page
      .getByRole("button", { name: "Edit Feedback", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Edit Feedback" });
    await dialog
      .getByLabel("Interview feedback", { exact: true })
      .fill("E2E updated feedback");
    await dialog.getByRole("button", { name: "Save Feedback" }).click();
    await page.getByText("E2E updated feedback", { exact: true }).waitFor();
    await page.reload();
    await page.getByText("E2E updated feedback", { exact: true }).waitFor();
    assert.equal(
      (await inspectFixture()).feedback.filter(
        (row) =>
          row.meetingId === fixture.meetings.onsite.id &&
          row.text === "E2E updated feedback",
      ).length,
      1,
    );
  });

  await run("E2E-FEEDBACK-PAGES", async ({ page, fixture, origin }) => {
    await login(page, fixture.accounts.owner);
    await detail(page, origin, { id: fixture.feedbackMeetingId });
    await check(async () =>
      assert.equal(await page.locator("[data-feedback-id]").count(), 50),
    );
    const initial = await page
      .locator("[data-feedback-id]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.feedbackId));
    await page.getByRole("button", { name: "Load older feedback" }).click();
    await check(async () =>
      assert.equal(await page.locator("[data-feedback-id]").count(), 55),
    );
    const complete = await page
      .locator("[data-feedback-id]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.feedbackId));
    assert.equal(new Set(complete).size, 55);
    const expected = Array.from(
      { length: 55 },
      (_, index) =>
        `41000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    // API fetches the newest page, then returns each page chronologically.
    assert.deepEqual(initial, expected.slice(5));
    assert.deepEqual(complete, expected);
    assert.equal(
      await page.getByRole("button", { name: "Load older feedback" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Edit Feedback", exact: true })
        .count(),
      1,
    );
  });

  await run(
    "E2E-TIMEZONE-01",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      await detail(page, origin, fixture.meetings.onsite);
      assert.match(
        await page
          .locator(`time[datetime="${fixture.meetings.onsite.startsAt}"]`)
          .innerText(),
        /10:00/,
      );
      assert.match(
        await page
          .locator(`time[datetime="${fixture.meetings.onsite.endsAt}"]`)
          .innerText(),
        /11:00/,
      );
    },
    { timezoneId: "America/Los_Angeles" },
  );

  await run(
    "E2E-NAVIGATION-01",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let held = true;
      const target = `/meetings/${fixture.meetings.onsite.id}`;
      await page.route(`**${target}?**`, async (route) => {
        const headers = route.request().headers();
        if (held && headers.rsc === "1" && !headers["next-router-prefetch"])
          await gate;
        await route.continue();
      });
      try {
        const prefetched = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === target &&
            response.request().headers()["next-router-prefetch"] === "1",
        );
        await page.goto(`${origin}/dashboard?date=${fixture.date}`);
        const link = page.getByRole("link", {
          name: `View ${fixture.meetings.onsite.candidateName} meeting`,
        });
        await link.waitFor();
        assert.equal((await prefetched).ok(), true);
        await page
          .locator("header")
          .first()
          .evaluate((header) => (header.dataset.e2ePersistent = "true"));
        const requested = page.waitForRequest(
          (request) =>
            new URL(request.url()).pathname === target &&
            request.headers().rsc === "1" &&
            !request.headers()["next-router-prefetch"],
        );
        await link.click();
        await requested;
        await page.getByText("Loading page…", { exact: true }).waitFor();
        assert.equal(
          await page.locator("header[data-e2e-persistent]").count(),
          1,
        );
        held = false;
        release();
        await page
          .getByRole("heading", { name: "Candidate profile" })
          .waitFor();
        assert.equal(
          await page.locator("header[data-e2e-persistent]").count(),
          1,
        );
        await page.goBack();
        await link.waitFor();
        await page.goForward();
        await page
          .getByRole("heading", { name: "Candidate profile" })
          .waitFor();
        assert.equal(await page.locator("[data-workspace-loading]").count(), 0);
      } finally {
        held = false;
        release();
      }
    },
    { tags: ["@critical"] },
    "real local stack with held App Router navigation response",
  );

  await run(
    "E2E-READ-RECOVERY",
    async ({ page, fixture, origin }) => {
      await login(page, fixture.accounts.owner);
      let fail = true;
      await page.route(
        `**/api/v1/meetings/${fixture.meetings.onsite.id}/summary`,
        (route) => (fail ? route.abort("connectionfailed") : route.continue()),
      );
      await page.goto(`${origin}/meetings/${fixture.meetings.onsite.id}`);
      await page
        .getByRole("button", { name: "Retry loading meeting details" })
        .waitFor();
      fail = false;
      await page
        .getByRole("button", { name: "Retry loading meeting details" })
        .click();
      await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
    },
    {},
    "real local stack with injected summary transport failure",
  );
});
