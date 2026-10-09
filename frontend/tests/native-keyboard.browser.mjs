import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import {
  nativeKeyboardProfile,
  verifyNativeKeyboard,
} from "./native-keyboard.mjs";

const engines = (process.env.PICKER_BROWSERS ?? "chromium").split(",");
assert.ok(
  engines.length && engines.every((engine) => ["chromium", "webkit"].includes(engine)),
);
for (const engine of engines) {
  const browser = await { chromium, webkit }[engine].launch({
    headless: true,
    ...(engine === "chromium" && process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const profile = nativeKeyboardProfile(engine);
    for (const hasTouch of [false, true]) {
      const evidence = await verifyNativeKeyboard(browser, profile, { hasTouch });
      assert.deepEqual(evidence.sequence, ["cancel", "save", "after"]);
      assert.equal(browser.contexts().length, 0, "Successful preflight closes its context");
      console.log(`PASS ${engine} native keyboard profile, hasTouch=${hasTouch}`);
    }
    // Deliberately incompatible input must fail, not retry Tab/Option+Tab to pass.
    await assert.rejects(
      verifyNativeKeyboard(browser, { ...profile, nextKey: "ArrowRight" }),
      /Native keyboard preflight failed.*expected cancel, observed notes/,
    );
    assert.equal(browser.contexts().length, 0, "Failed preflight closes its context");
    console.log(`PASS ${engine} incompatible keyboard profile fails closed`);
  } finally {
    await browser.close();
  }
}
