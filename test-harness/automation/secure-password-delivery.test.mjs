import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../../src/background.js", import.meta.url), "utf8");
const content = await readFile(new URL("../../src/content.js", import.meta.url), "utf8");

function background() {
  let listener;
  let tab = { id: 1, url: "https://account.example/login" };
  const sent = [], reads = [];
  let onRead = async () => {};
  const State = { Unlocked: "unlocked", Disconnected: "disconnected" };
  class ApplePasswords {
    state = State.Unlocked;
    ready = true;
    onStateChange() {}
    onOneTimeCodeAvailable() {}
    async getPasswordForLoginName(tabId, url, login) {
      reads.push(url);
      await onRead();
      return { username: login.username, password: "synthetic-password" };
    }
  }
  const event = { addListener() {} };
  const chrome = {
    runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, onStartup: event, onInstalled: event, sendMessage: async () => {} },
    alarms: { create() {}, onAlarm: event }, commands: { onCommand: event },
    tabs: { query: async () => [tab], sendMessage: async (id, msg) => { sent.push(msg); return { filled: true }; } },
  };
  vm.runInNewContext(source.replace(/^import .*;\s*/m, ""), { chrome, ApplePasswords, State, URL, console, setTimeout });
  return {
    sent, reads,
    setTab(url) { tab = { ...tab, url }; },
    onRead(fn) { onRead = fn; },
    send(msg) { return new Promise(resolve => listener(msg, { id: "test" }, resolve)); },
  };
}

test("refresh refuses an HTTPS-to-HTTP downgrade before reading the vault", async () => {
  const bg = background();
  await bg.send({ type: "fillOnPage", loginName: { username: "user" } });
  bg.setTab("http://account.example/login");
  const result = await bg.send({ type: "refreshAndRefill" });
  assert.equal(result.refilled, false);
  assert.equal(bg.reads.length, 1);
  assert.equal(bg.sent.length, 1);
});

test("refresh refuses a changed port and still works on the original origin", async () => {
  const bg = background();
  await bg.send({ type: "fillOnPage", loginName: { username: "user" } });
  bg.setTab("https://account.example:8443/login");
  assert.equal((await bg.send({ type: "refreshAndRefill" })).refilled, false);
  bg.setTab("https://account.example/other-path");
  assert.equal((await bg.send({ type: "refreshAndRefill" })).refilled, true);
  assert.equal(bg.sent.at(-1).expectedOrigin, "https://account.example");
});

test("password cache does not reuse credentials across ports", async () => {
  const bg = background();
  await bg.send({ type: "fillOnPage", loginName: { username: "user" } });
  bg.setTab("https://account.example:8443/login");
  await bg.send({ type: "fillOnPage", loginName: { username: "user" } });
  assert.equal(bg.reads.length, 2);
});

function recipient(origin, msg) {
  let listener, filled = false, response;
  const start = content.indexOf("chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {");
  const end = content.indexOf("\n\nchrome.runtime.onMessage.addListener", start);
  vm.runInNewContext(content.slice(start, end), {
    chrome: { runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } } } },
    location: { origin, hostname: new URL(origin).hostname }, Date,
    liveField() {}, fillAnchor: null,
    fillCredentials() { filled = true; return true; },
  });
  listener(msg, { id: "test" }, value => { response = value; });
  return { filled, response };
}

test("recipient rejects navigation to HTTP or a different port during native authentication", async () => {
  const bg = background();
  bg.onRead(async () => bg.setTab("http://account.example/login"));
  await bg.send({ type: "fillOnPage", loginName: { username: "user" } });
  const msg = bg.sent[0];
  assert.equal(recipient("http://account.example", msg).filled, false);
  assert.equal(recipient("https://account.example:8443", msg).filled, false);
  assert.equal(recipient("https://account.example", msg).filled, true);
  assert.equal(recipient("https://account.example", { ...msg, expectedOrigin: undefined }).filled, false);
});
