import assert from "node:assert/strict";
import { runSuite, login, check } from "./helpers.mjs";
import { inspectFixture } from "./fixture.mjs";

async function detail(page, origin, meeting) {
  await page.goto(`${origin}/meetings/${meeting.id}`);
  await page.getByRole("heading", { name: "Candidate profile" }).waitFor();
  await page.getByLabel("Interview notes", { exact: true }).waitFor();
}
async function request(page, path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        ...(body === undefined
          ? {}
          : {
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "MeetingManager",
              },
              body: JSON.stringify(body),
            }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body },
  );
}
function ownNote(snapshot, meetingId, memberId) {
  const note = snapshot.notes.find(
    (note) =>
      note.meetingId === meetingId && note.authorKey === `member:${memberId}`,
  );
  assert.ok(note, "Expected the fixture member's own note");
  return note;
}
async function savedNote(page, text) {
  await page.getByLabel("Interview notes", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Save Note", exact: true }).click();
  await page.getByText("Notes saved.", { exact: true }).waitFor();
}

await runSuite("authorization", async ({ run }) => {
  await run("E2E-NOTES-01", async ({ page, fixture, origin, newActor }) => {
    const { owner, attendee } = fixture.accounts;
    const meeting = fixture.meetings.onsite;
    const before = await inspectFixture();
    const ownerSeed = ownNote(before, meeting.id, owner.id).text;
    const attendeeSeed = ownNote(before, meeting.id, attendee.id).text;
    assert.notEqual(ownerSeed, attendeeSeed);
    await login(page, owner);
    await detail(page, origin, meeting);
    await check(async () =>
      assert.equal(
        await page.getByLabel("Interview notes", { exact: true }).inputValue(),
        ownerSeed,
      ),
    );
    assert.equal(
      await page.getByText(attendeeSeed, { exact: true }).count(),
      0,
    );
    const ownerText = "E2E owner private note changed through the UI";
    await savedNote(page, ownerText);
    await page.reload();
    await check(async () =>
      assert.equal(
        await page.getByLabel("Interview notes", { exact: true }).inputValue(),
        ownerText,
      ),
    );
    const { page: attendeePage } = await newActor();
    await login(attendeePage, attendee);
    await detail(attendeePage, origin, meeting);
    await check(async () =>
      assert.equal(
        await attendeePage
          .getByLabel("Interview notes", { exact: true })
          .inputValue(),
        attendeeSeed,
      ),
    );
    assert.equal(
      await attendeePage.getByText(ownerText, { exact: true }).count(),
      0,
    );
    const attendeeRead = await request(
      attendeePage,
      `/api/v1/meetings/${meeting.id}/notes/me`,
    );
    assert.equal(attendeeRead.status, 200);
    assert.equal(attendeeRead.body.note.text, attendeeSeed);
    assert.equal(JSON.stringify(attendeeRead.body).includes(ownerText), false);
    const attendeeText = "E2E attendee private note changed independently";
    await savedNote(attendeePage, attendeeText);
    await attendeePage.reload();
    await check(async () =>
      assert.equal(
        await attendeePage
          .getByLabel("Interview notes", { exact: true })
          .inputValue(),
        attendeeText,
      ),
    );
    const after = await inspectFixture();
    assert.equal(ownNote(after, meeting.id, owner.id).text, ownerText);
    assert.equal(ownNote(after, meeting.id, attendee.id).text, attendeeText);
    await page.reload();
    await check(async () =>
      assert.equal(
        await page.getByLabel("Interview notes", { exact: true }).inputValue(),
        ownerText,
      ),
    );
    assert.equal(
      await page.getByText(attendeeText, { exact: true }).count(),
      0,
    );
    await savedNote(attendeePage, "");
    const cleared = await inspectFixture();
    assert.equal(ownNote(cleared, meeting.id, attendee.id).text, "");
    assert.equal(ownNote(cleared, meeting.id, owner.id).text, ownerText);
    await attendeePage.reload();
    await check(async () =>
      assert.equal(
        await attendeePage
          .getByLabel("Interview notes", { exact: true })
          .inputValue(),
        "",
      ),
    );
  });

  await run(
    "E2E-NOTES-CONFLICT",
    async ({ page, fixture, origin, newActor }) => {
      const owner = fixture.accounts.owner;
      const meeting = fixture.meetings.onsite;
      await login(page, owner);
      await detail(page, origin, meeting);
      const { page: secondPage } = await newActor();
      await login(secondPage, owner);
      await detail(secondPage, origin, meeting);
      const original = ownNote(
        await inspectFixture(),
        meeting.id,
        owner.id,
      ).text;
      await check(async () =>
        assert.equal(
          await secondPage
            .getByLabel("Interview notes", { exact: true })
            .inputValue(),
          original,
        ),
      );
      const firstText = "E2E note saved in the first context";
      const secondText = "E2E concurrent draft retained in the second context";
      await secondPage
        .getByLabel("Interview notes", { exact: true })
        .fill(secondText);
      await savedNote(page, firstText);
      const staleWrite = secondPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/meetings/${meeting.id}/notes/me`) &&
          response.request().method() === "POST",
      );
      await secondPage
        .getByRole("button", { name: "Save Note", exact: true })
        .click();
      assert.equal((await staleWrite).status(), 409);
      await secondPage
        .getByText("The notes were changed elsewhere.", { exact: false })
        .waitFor();
      assert.equal(
        await secondPage
          .getByLabel("Interview notes", { exact: true })
          .inputValue(),
        secondText,
      );
      assert.equal(
        ownNote(await inspectFixture(), meeting.id, owner.id).text,
        firstText,
      );
      await secondPage
        .getByRole("button", { name: "Load latest notes to review" })
        .click();
      await secondPage.getByRole("heading", { name: "Saved notes" }).waitFor();
      await secondPage.getByText(firstText, { exact: true }).waitFor();
      await secondPage
        .getByRole("button", { name: "Keep my text to save again" })
        .click();
      await secondPage
        .getByRole("button", { name: "Save Note", exact: true })
        .click();
      await secondPage.getByText("Notes saved.", { exact: true }).waitFor();
      assert.equal(
        ownNote(await inspectFixture(), meeting.id, owner.id).text,
        secondText,
      );
      await page.reload();
      await check(async () =>
        assert.equal(
          await page
            .getByLabel("Interview notes", { exact: true })
            .inputValue(),
          secondText,
        ),
      );
    },
  );

  await run("E2E-AUTHZ-01", async ({ page, fixture, origin, newActor }) => {
    const meeting = fixture.meetings.onsite;
    await login(page, fixture.accounts.owner);
    await detail(page, origin, meeting);
    await page
      .getByRole("link", { name: "Edit Meeting", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Cancel Meeting", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Delete Meeting", exact: true })
      .waitFor();
    const read = await request(page, `/api/v1/meetings/${meeting.id}`);
    assert.equal(read.status, 200);
    const expectedUpdatedAt = read.body.meeting.updatedAt;
    const { page: attendeePage } = await newActor();
    await login(attendeePage, fixture.accounts.attendee);
    await detail(attendeePage, origin, meeting);
    assert.equal(
      await attendeePage
        .getByRole("link", { name: "Edit Meeting", exact: true })
        .count(),
      0,
    );
    for (const name of ["Cancel Meeting", "Delete Meeting"])
      assert.equal(
        await attendeePage.getByRole("button", { name, exact: true }).count(),
        0,
      );
    const before = await inspectFixture();
    for (const [action, change] of [
      ["edit", { title: "E2E unauthorized edit must not persist" }],
      ["team", { addMemberIds: [], removeEmails: [] }],
      ["cancel", {}],
      ["delete", {}],
    ]) {
      const response = await request(
        attendeePage,
        `/api/v1/meetings/${meeting.id}/${action}`,
        { expectedUpdatedAt, ...change },
      );
      assert.equal(response.status, 404, `${action} must reject a noncreator`);
      assert.equal(response.body.error.code, "MEETING_NOT_FOUND");
    }
    assert.deepEqual(
      await inspectFixture(),
      before,
      "Denied creator mutations must not alter any persisted fixture data",
    );
    await attendeePage.goto(`${origin}/meetings/${meeting.id}/edit`);
    await attendeePage
      .getByRole("heading", {
        name: "Meeting not found or you do not have permission to edit it.",
      })
      .waitFor();
    assert.equal(
      await attendeePage
        .getByRole("button", { name: "Save Meeting", exact: true })
        .count(),
      0,
    );
  });

  await run("E2E-AUTHZ-02", async ({ page, fixture, origin }) => {
    const meeting = fixture.meetings.onsite;
    await login(page, fixture.accounts.outsider);
    await page.goto(`${origin}/meetings/${meeting.id}`);
    await page
      .getByRole("heading", {
        name: "Meeting not found or you do not have access.",
      })
      .waitFor();
    assert.equal(
      await page.getByLabel("Interview notes", { exact: true }).count(),
      0,
    );
    const before = await inspectFixture();
    for (const path of [
      `/api/v1/meetings/${meeting.id}/summary`,
      `/api/v1/meetings/${meeting.id}/notes/me`,
    ]) {
      const denied = await request(page, path);
      assert.equal(denied.status, 404);
      assert.equal(denied.body.error.code, "MEETING_NOT_FOUND");
    }
    const deniedWrite = await request(
      page,
      `/api/v1/meetings/${meeting.id}/notes/me`,
      {
        text: "E2E unauthorized note must not persist",
        expectedUpdatedAt: null,
      },
    );
    assert.equal(deniedWrite.status, 404);
    assert.equal(deniedWrite.body.error.code, "MEETING_NOT_FOUND");
    assert.deepEqual(await inspectFixture(), before);
  });

  await run("E2E-AUTHZ-NOTE-01", async ({ page, fixture, origin }) => {
    const meeting = fixture.meetings.onsite;
    await login(page, fixture.accounts.attendee);
    await detail(page, origin, meeting);
    const path = `/api/v1/meetings/${meeting.id}/notes/me`;
    const current = await request(page, path);
    assert.equal(current.status, 200);
    const before = await inspectFixture();
    const authorKey = `member:${fixture.accounts.owner.id}`;
    const foreignRead = await request(
      page,
      `${path}?authorKey=${encodeURIComponent(authorKey)}`,
    );
    assert.equal(foreignRead.status, 400);
    assert.equal(foreignRead.body.error.code, "VALIDATION_ERROR");
    const foreignWrite = await request(page, path, {
      authorKey,
      text: "E2E forged foreign note must not persist",
      expectedUpdatedAt: current.body.note.updatedAt,
    });
    assert.equal(foreignWrite.status, 400);
    assert.equal(foreignWrite.body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(await inspectFixture(), before);
  });
});
