const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("the inline renderer script parses as JavaScript", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, "index.html should contain a renderer script");
  assert.doesNotThrow(() => new vm.Script(match[1], { filename: "index.html#renderer" }));
});
