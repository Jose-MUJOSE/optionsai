const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../src/lib/researchDisplay.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const { selectReports, summaryOf, comparisonCSV, stanceLabel, stanceGroup, stanceClass } = sandbox.exports;
const job = (id, ticker, mode, created_at, conviction) => ({ id, ticker, mode, created_at, status: "completed", summary: { decision: "hold", conviction, thesis: "Evidence" } });

test("latest-only keeps separate options and stock histories without mutating originals", () => {
  const rows = [job("old", "AAPL", "stock", "2026-11-01", 8), job("new", "AAPL", "stock", "2026-11-05", 5), job("options", "AAPL", "options", "2026-11-02", 6)];
  const original = JSON.stringify(rows);
  assert.equal(selectReports(rows, true, "date").map(j => j.id).join(","), "new,options");
  assert.equal(selectReports(rows, false, "date").length, 3);
  assert.equal(JSON.stringify(rows), original);
});
test("incomplete conclusions stay absent and missing confidence sorts below real zero", () => {
  const zero = job("zero", "A", "stock", "2026-11-01", 0);
  const unknown = job("unknown", "B", "stock", "2026-11-02", undefined);
  assert.equal(selectReports([unknown, zero], false, "conviction")[0].id, "zero");
  assert.equal(summaryOf({ ...zero, status: "failed" }), null);
  assert.equal(stanceLabel(undefined, true), "未提供");
});
test("CSV safely preserves quotes, newlines and spreadsheet formula-like text", () => {
  const row = job("csv", "AAPL", "stock", "2026-11-01", 5);
  row.summary.thesis = ' =HYPERLINK("bad")\ntext';
  const csv = comparisonCSV([row]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")\ntext"'));
  assert.ok(csv.includes('"AAPL"'));
});
test("older Chinese decisions and English decisions share a filter and color", () => {
  assert.equal(stanceGroup("卖出"), stanceGroup("sell"));
  assert.equal(stanceGroup("看多"), stanceGroup("buy"));
  assert.equal(stanceClass("买入"), stanceClass("bullish"));
  assert.equal(stanceClass("看空"), stanceClass("sell"));
  assert.equal(stanceGroup("iron condor"), "iron condor");
});
