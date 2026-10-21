import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../../src/background.js", import.meta.url), "utf8");
function background() {
  let listener, onUpdated, onRemoved;
  let tab = { id: 1, url: "https://account.example/verify" };
  let returnedAccount = "user";
  const sent = [], reads = [];
  const State = { Unlocked: "unlocked", Disconnected: "disconnected" };
  class ApplePasswords {
    state = State.Unlocked;
    ready = true;
    canFillOneTimeCodes = true;
    onStateChange() {}
    onOneTimeCodeAvailable() {}
    async getOneTimeCodes(id, frame, urls) {
      return { entries: [{ source: "totp", username: "user", domain: new URL(urls[0]).hostname }], requiresAuth: false };
    }
    async readOneTimeCode(id, frame, urls) {
      reads.push({ frame, urls });
      return [{ source: "totp", username: returnedAccount, domain: new URL(urls[0]).hostname, code: "123456" }];
    }
  }
  const event = { addListener() {} };
  const chrome = {
    runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } }, onStartup: event, onInstalled: event, sendMessage: async () => {} },
    alarms: { create() {}, onAlarm: event }, commands: { onCommand: event },
    tabs: {
      query: async () => [tab],
      onUpdated: { addListener(fn) { onUpdated = fn; } }, onRemoved: { addListener(fn) { onRemoved = fn; } },
      async sendMessage(id, msg, options, callback) { sent.push({ ...msg, options }); callback?.({ filled: true }); return { filled: true }; },
    },
  };
  vm.runInNewContext(source.replace(/^import .*;\s*/m, ""), { chrome, ApplePasswords, State, URL, console, crypto: webcrypto, setTimeout });
  return {
    sent, reads,
    setTab(url) { tab = { ...tab, url }; },
    changeAccount(name) { returnedAccount = name; },
    navigate() { onUpdated(1, { url: tab.url }); }, remove() { onRemoved(1); },
    send(msg, sender = { id: "test" }) { return new Promise(resolve => listener(msg, sender, resolve)); },
  };
}
const sender = (url, frameId = 0, documentId = "doc") => ({ id: "test", url, frameId, documentId, tab: { id: 1, url: "https://account.example/verify" } });
const list = (bg, from) => bg.send({ type: "inlineOneTimeCodes" }, from);
const fill = (bg, id, from) => bg.send({ type: "inlineFillOneTimeCode", id }, from);

test("two frames retain independent lists and cannot exchange row IDs", async () => {
  const bg = background();
  const a = sender("https://account.example/verify");
  const b = sender("https://tenant.auth0.com/verify", 2, "other-doc");
  const rowA = (await list(bg, a)).rows[0];
  const rowB = (await list(bg, b)).rows[0];
  assert.notEqual(rowA.id, rowB.id);
  assert.equal((await fill(bg, rowB.id, a)).ok, false);
  assert.equal((await fill(bg, rowA.id, a)).filled, true);
  assert.equal(bg.reads[0].frame, 0);
  assert.equal(bg.sent[0].expectedOrigin, "https://account.example");
  assert.equal(bg.sent[0].options.documentId, "doc");
});

test("popup rejects a code listed before cross-origin navigation", async () => {
  const bg = background();
  const row = (await bg.send({ type: "getOneTimeCodes" })).rows[0];
  bg.setTab("https://different.example/verify");
  assert.equal((await bg.send({ type: "fillOneTimeCode", id: row.id })).ok, false);
  assert.equal(bg.reads.length, 0);
  assert.equal(bg.sent.length, 0);
});

test("same-origin popup fills only the top frame", async () => {
  const bg = background();
  const row = (await bg.send({ type: "getOneTimeCodes" })).rows[0];
  assert.equal((await bg.send({ type: "fillOneTimeCode", id: row.id })).filled, true);
  assert.equal(bg.sent[0].options.frameId, 0);
});

test("replaced lists and changed documents reject stale IDs", async () => {
  const bg = background();
  const a = sender("https://account.example/verify");
  const stale = (await list(bg, a)).rows[0];
  const current = (await list(bg, a)).rows[0];
  assert.equal((await fill(bg, stale.id, a)).ok, false);
  assert.equal((await fill(bg, current.id, { ...a, documentId: "new-doc" })).ok, false);
  assert.equal(bg.reads.length, 0);
});

test("a missing account never falls back to another account's TOTP", async () => {
  const bg = background();
  const a = sender("https://account.example/verify");
  const row = (await list(bg, a)).rows[0];
  bg.changeAccount("other-user");
  assert.equal((await fill(bg, row.id, a)).ok, false);
  assert.equal(bg.sent.length, 0);
});

test("navigation and tab closure invalidate cached lists", async () => {
  for (const invalidate of ["navigate", "remove"]) {
    const bg = background();
    const a = sender("https://account.example/verify");
    const row = (await list(bg, a)).rows[0];
    bg[invalidate]();
    assert.equal((await fill(bg, row.id, a)).ok, false);
  }
});

test("the OTP recipient rejects HTTP downgrades, other ports, and missing origins", async () => {
  const content = await readFile(new URL("../../src/content.js", import.meta.url), "utf8");
  const marker = "chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {";
  const start = content.indexOf(marker, content.indexOf(marker) + marker.length);
  const end = content.indexOf("\nlet fillAnchor", start);
  for (const origin of ["https://account.example", "http://account.example", "https://account.example:8443"]) {
    let listener, filled = false;
    vm.runInNewContext(content.slice(start, end), {
      chrome: { runtime: { id: "test", onMessage: { addListener(fn) { listener = fn; } } } },
      location: { origin, hostname: "account.example" },
      otpTargetField: () => ({}), fillOtp: () => { filled = true; },
    });
    listener({ type: "fillOtp", code: "123456", expectedOrigin: "https://account.example" }, { id: "test" }, () => {});
    assert.equal(filled, origin === "https://account.example");
    filled = false;
    listener({ type: "fillOtp", code: "123456" }, { id: "test" }, () => {});
    assert.equal(filled, false);
  }
});
