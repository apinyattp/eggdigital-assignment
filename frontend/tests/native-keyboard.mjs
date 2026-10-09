import assert from "node:assert/strict";

// Select once from the host/engine, never in response to an application failure.
export function nativeKeyboardProfile(engine, platform = process.platform) {
  assert.ok(["chromium", "webkit"].includes(engine), "Unsupported keyboard engine");
  const optionTab = platform === "darwin" && engine === "webkit";
  return Object.freeze({
    name: optionTab ? "macos-webkit-option-tab" : "standard-tab",
    engine,
    platform,
    nextKey: optionTab ? "Alt+Tab" : "Tab",
  });
}

export async function verifyNativeKeyboard(browser, profile, contextOptions = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...contextOptions,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent(`
      <form>
        <label for="notes">Notes</label><textarea id="notes"></textarea>
        <a id="cancel" href="#cancel">Cancel</a>
        <button id="save" type="submit">Save</button>
        <button id="disabled" type="button" disabled>Disabled</button>
        <label for="after">Next input</label><input id="after">
      </form>
    `);
    await page.evaluate(() => {
      window.nativeKeyboardSubmissions = 0;
      document.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.nativeKeyboardSubmissions++;
      });
    });
    // A click establishes the starting position; subsequent focus must come from keys.
    await page.getByLabel("Notes", { exact: true }).click();
    const sequence = [];
    for (const expected of ["cancel", "save", "after"]) {
      await page.keyboard.press(profile.nextKey);
      const active = await page.evaluate(() => document.activeElement?.id);
      sequence.push(active);
      if (active !== expected) {
        throw new Error(
          `Native keyboard preflight failed (${profile.name}, ${profile.platform}/${profile.engine}, ${profile.nextKey}): expected ${expected}, observed ${active || "body"}. Verify the host keyboard-navigation configuration; no alternate key was attempted.`,
        );
      }
      if (expected === "save") await page.keyboard.press("Enter");
    }
    assert.equal(
      await page.evaluate(() => window.nativeKeyboardSubmissions),
      1,
      "Native keyboard preflight: Enter submits exactly once",
    );
    assert.equal(await page.locator("#disabled").isDisabled(), true);
    console.log(`PASS native keyboard preflight: ${JSON.stringify({ ...profile, sequence })}`);
    return { ...profile, sequence };
  } finally {
    await context.close();
  }
}
