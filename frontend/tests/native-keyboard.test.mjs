import assert from "node:assert/strict";
import test from "node:test";
import { nativeKeyboardProfile } from "./native-keyboard.mjs";

test("macOS WebKit selects its native all-controls gesture before execution", () => {
  const profile = nativeKeyboardProfile("webkit", "darwin");
  assert.equal(profile.name, "macos-webkit-option-tab");
  assert.equal(profile.nextKey, "Alt+Tab");
  assert.ok(Object.isFrozen(profile));
});

test("the existing Chromium and non-macOS profiles retain plain Tab", () => {
  for (const [engine, platform] of [
    ["chromium", "darwin"],
    ["chromium", "linux"],
    ["webkit", "linux"],
    ["chromium", "win32"],
    ["webkit", "win32"],
  ]) {
    const profile = nativeKeyboardProfile(engine, platform);
    assert.equal(profile.name, "standard-tab");
    assert.equal(profile.nextKey, "Tab");
    assert.equal(profile.platform, platform);
    assert.equal(profile.engine, engine);
  }
});

test("unknown engines fail instead of silently selecting a gesture", () => {
  assert.throws(() => nativeKeyboardProfile("unknown"), /Unsupported keyboard engine/);
});
