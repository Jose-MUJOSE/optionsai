const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the shipped API client with a real ReadableStream, no network/key.
function apiWith(response) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/api.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const context = { exports: {}, process: { env: {} }, TextDecoder, fetch: async () => response };
  vm.runInNewContext(output, context);
  return context.exports;
}

function streamResponse(parts) {
  return new Response(new ReadableStream({ start(controller) {
    const bytes = new TextEncoder().encode(parts);
    // Split arbitrarily, including inside UTF-8 text and SSE delimiters.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  }}));
}
const params = { ticker: 'AAPL', mode: 'stock', locale: 'zh' };
async function collect(api) {
  const events = [];
  for await (const event of api.streamTraderAgent(params)) events.push(event);
  return events;
}

test('split UTF-8 and SSE chunks retain the final done event', async () => {
  const events = await collect(apiWith(streamResponse('data: {"type":"phase","phase":"研究"}\n\ndata: {"type":"done","researchers":[],"manager":{}}\n\n')));
  assert.equal(events[0].phase, '研究');
  assert.equal(events[1].type, 'done');
});
test('disconnected stream is an error even after a manager result', async () => {
  await assert.rejects(collect(apiWith(streamResponse('data: {"type":"manager","result":{}}\n\n'))), /before completion/);
});
test('malformed report event is never silently discarded', async () => {
  await assert.rejects(collect(apiWith(streamResponse('data: {invalid}\n\n'))));
});
test('server error event is delivered as a terminal event', async () => {
  const events = await collect(apiWith(streamResponse('data: {"type":"error","message":"test"}\n\n')));
  assert.equal(events[0].type, 'error');
});
test('missing key error is preserved for the UI', async () => {
  await assert.rejects(collect(apiWith(new Response('{"detail":"Configure your API key"}', { status: 503 }))), /Configure your API key/);
});
