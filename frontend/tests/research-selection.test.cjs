const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/researchSelection.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { addTickers, parseTickers, removeTickers, selectionCoverage, MAX_RESEARCH_BATCH } = context.exports;
const catalog = require('../src/data/research-catalog.json');
const plain = value => JSON.parse(JSON.stringify(value));

test('multiple sectors merge without duplicates and exclusions stay removed', () => {
  const chips = catalog.categories.find(c => c.id === 'semiconductors').symbols;
  const ai = catalog.categories.find(c => c.id === 'ai').symbols;
  const combined = addTickers(chips, ai);
  assert.equal(combined.length, new Set([...chips, ...ai]).size);
  const trimmed = removeTickers(combined, ['NVDA']);
  assert.equal(trimmed.includes('NVDA'), false);
  assert.equal(selectionCoverage(chips, trimmed), 'partial');
  assert.equal(selectionCoverage(chips, combined), 'all');
  assert.equal(selectionCoverage(chips, []), 'none');
});
test('full large sector is retained rather than truncated to 30', () => {
  const banks = catalog.categories.find(c => c.id === 'banks').symbols;
  assert.ok(banks.length > 100);
  assert.deepEqual(plain(addTickers([], banks)), banks);
  assert.ok(MAX_RESEARCH_BATCH >= banks.length);
});
test('manual input accepts Chinese separators and canonicalizes class shares', () => {
  assert.deepEqual(plain(parseTickers('nvda，AMD\nNVDA; brk.b BRK/B BRK-B')), ['NVDA', 'AMD', 'BRK-B']);
});
test('catalog integrity, requested categories, ADRs and source provenance', () => {
  for (const id of ['china', 'commercial_space', 'semiconductors', 'insurance', 'banks', 'biotech', 'pharma']) {
    assert.ok(catalog.categories.find(c => c.id === id)?.symbols.length);
  }
  assert.ok(catalog.categories.find(c => c.id === 'china').symbols.includes('NIO'));
  assert.ok(catalog.categories.find(c => c.id === 'insurance').symbols.includes('BRK-B'));
  for (const c of catalog.categories) {
    assert.equal(c.symbols.length, new Set(c.symbols).size);
    assert.ok(c.symbols.every(t => catalog.stocks[t]?.name));
  }
  assert.equal(new Set(catalog.categories.map(c => c.id)).size, catalog.categories.length);
  assert.ok(catalog.sources.every(s => s.sha256.length === 64));
});
