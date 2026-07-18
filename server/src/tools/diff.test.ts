import { test } from "node:test";
import assert from "node:assert/strict";
import { makeUnifiedDiff } from "./diff.js";

test("unified diff marks changed lines", () => {
  const before = "if (user) {\n  login();\n}";
  const after = "if (user && user.active) {\n  login();\n}";
  const diff = makeUnifiedDiff("auth.ts", before, after);
  assert.match(diff.unified, /-if \(user\) \{/);
  assert.match(diff.unified, /\+if \(user && user\.active\) \{/);
  assert.match(diff.unified, / {2}login\(\);/); // context line preserved
});

test("identical content yields no +/- lines", () => {
  const diff = makeUnifiedDiff("x.ts", "a\nb", "a\nb");
  assert.ok(!/^[+-][^+-]/m.test(diff.unified.split("\n").slice(2).join("\n")));
});
