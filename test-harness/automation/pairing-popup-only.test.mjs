import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../../src/background.js", import.meta.url), "utf8");
const content = await readFile(new URL("../../src/content.js", import.meta.url), "utf8");
function background() {
  let listener, opened = 0, verified = 0;
  const State = { Unlocked: "unlocked", Disconnected: "disconnected" };
  class ApplePasswords {
    state = State.Unlocked;
    ready = true;
    onStateChange() {}
    onOneTimeCodeAvailable() {}
    async verifyPin() { verified++; }
  }
  const event = { addListener() {} };
  const chrome = {
    runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, onStartup: event, onInstalled: event, sendMessage: async () => {} },
    action: { async openPopup() { opened++; } },
    alarms: { create() {}, onAlarm: event }, commands: { onCommand: event },
  };
  vm.runInNewContext(source.replace(/^import .*;\s*/m, ""), { chrome, ApplePasswords, State, URL, console, setTimeout });
  return {
    counts: () => ({ opened, verified }),
    send(msg, sender) { return new Promise(resolve => listener(msg, { id: "test", ...sender }, resolve)); },
  };
}
test("content scripts can open the extension popup but cannot submit a pairing secret", async () => {
  const bg = background();
  const sender = { tab: { id: 1 }, frameId: 0 };
  assert.equal((await bg.send({ type: "openUnlock" }, sender)).ok, true);
  assert.equal((await bg.send({ type: "verifyPin", pin: "123456" }, sender)).error, "forbidden");
  assert.equal((await bg.send({ type: "requestChallenge" }, sender)).error, "forbidden");
  assert.deepEqual(bg.counts(), { opened: 1, verified: 0 });
});
test("extension-owned UI retains the ability to verify pairing codes", async () => {
  const bg = background();
  assert.equal((await bg.send({ type: "verifyPin", pin: "123456" }, {})).ok, true);
  assert.equal(bg.counts().verified, 1);
});
test("inline unlock never creates an input or sends a PIN, including popup failure", async () => {
  const start = content.indexOf("async function buildLockedSuggestion(");
  const end = content.indexOf("\nfunction isNewPasswordField", start);
  for (const succeeds of [true, false]) {
    const tags = [], messages = [];
    const field = { isConnected: true };
    const element = () => ({ style: {}, appendChild() {} });
    const ctx = vm.createContext({
      removeSuggestion() {}, buildSuggestionBox: element, positionBox() {}, deepActiveElement: () => field,
      document: { createElement(tag) { tags.push(tag); return element(); } }, field,
      chrome: { runtime: { async sendMessage(msg) { messages.push(msg); return { ok: succeeds }; } } },
    });
    await vm.runInContext(`${content.slice(start, end)}\nbuildLockedSuggestion(field)`, ctx);
    assert.equal(tags.includes("input"), false);
    assert.deepEqual(messages.map(msg => msg.type), ["openUnlock"]);
  }
});
