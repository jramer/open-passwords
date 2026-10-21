import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../../src/content.js", import.meta.url), "utf8");
const start = source.indexOf("function isFillable(el) {");
const end = source.indexOf("\nfunction fillCredentials", start);
function fillable({ style = {}, rect = {}, ...properties } = {}) {
  const el = {
    isConnected: true, offsetParent: {},
    style: { display: "block", visibility: "visible", position: "static", opacity: "1", ...style },
    getBoundingClientRect: () => ({ width: 200, height: 30, left: 20, top: 20, right: 220, bottom: 50, ...rect }),
    ...properties,
  };
  return vm.runInNewContext(`${source.slice(start, end)}\nisFillable(el)`, {
    el, getComputedStyle: node => node.style,
    window: { innerWidth: 1000, innerHeight: 800 }, document: { documentElement: {} },
  });
}

test("hidden and detached password inputs are never fillable", () => {
  assert.equal(fillable({ style: { display: "none" } }), false);
  assert.equal(fillable({ style: { visibility: "hidden" } }), false);
  assert.equal(fillable({ style: { visibility: "collapse" } }), false);
  assert.equal(fillable({ offsetParent: null }), false);
  assert.equal(fillable({ isConnected: false }), false);
});
test("invisible ancestors are rejected, including a shadow host", () => {
  const hiddenParent = { style: { opacity: "0" } };
  assert.equal(fillable({ parentElement: hiddenParent }), false);
  assert.equal(fillable({ getRootNode: () => ({ host: hiddenParent }) }), false);
});
test("tiny, transparent, and far offscreen inputs are rejected", () => {
  assert.equal(fillable({ rect: { width: 1 } }), false);
  assert.equal(fillable({ style: { opacity: "0" } }), false);
  assert.equal(fillable({ rect: { left: -2000, right: -1800 } }), false);
});
test("ordinary and fixed-position visible login inputs remain fillable", () => {
  assert.equal(fillable(), true);
  assert.equal(fillable({ offsetParent: null, style: { position: "fixed" } }), true);
});
