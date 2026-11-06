const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const core = html.match(/<script id="parser-core">([\s\S]*?)<\/script>/)[1];
const parser = vm.runInNewContext(core + '\ncreateLogParser()', { TextEncoder });
const parse = text => parser.parseSources([{name:'test.log',text}]);

test('timestamped text extracts a level and retains the message', () => {
  const e = parser.parseLine('2026-11-06T09:00:01.123Z ERROR database timed out');
  assert.equal(e.timestamp, '2026-11-06T09:00:01.123Z');
  assert.equal(e.level, 'ERROR');
  assert.equal(e.message, 'database timed out');
});
test('bracketed timestamps and warning aliases', () => {
  const e = parser.parseLine('[2026-11-06 09:00:01,123] [WARNING] queue full');
  assert.equal(e.level, 'WARN');
  assert.equal(e.message, 'queue full');
});
test('Python logger format', () => {
  const e = parser.parseLine('2026-11-06 09:00:01,123 worker - INFO - Job finished');
  assert.equal(e.logger, 'worker');
  assert.equal(e.level, 'INFO');
  assert.equal(e.message, 'Job finished');
});
test('JSON Lines retains nested fields and normalizes Pino levels', async () => {
  const {entries} = await parse('{"time":1793955600,"level":50,"msg":"failed","request":{"id":"a"}}\n{"level":30,"msg":"ok"}');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, 'ERROR');
  assert.equal(entries[0].fields.request.id, 'a');
  assert.equal(entries[1].level, 'INFO');
  assert.equal(entries[0].source, 'test.log');
});
test('nested ECS severity and message', () => {
  const e=parser.parseLine('{"@timestamp":"2026-11-06T09:00:00Z","log":{"level":"warn","message":"nested"},"service":{"name":"api"}}');
  assert.equal(e.level,'WARN');assert.equal(e.message,'nested');assert.equal(e.logger,'api');
});
test('JSON array uses record numbers without invented line numbers', async () => {
  const {entries}=await parse('[\n {"level":"info","message":"one"},\n {"level":"fatal","message":"two"}\n]');
  assert.equal(entries.length,2);assert.equal(entries[1].record,2);assert.equal(entries[1].lineStart,null);assert.equal(entries[1].level,'CRITICAL');
});
test('malformed JSON is preserved as plain text', () => {
  const raw='{"message":"broken"';const e=parser.parseLine(raw);assert.equal(e.format,'plain');assert.equal(e.raw,raw);assert.equal(e.message,raw);
});
test('access logs infer severity and retain URL and HTTP status', () => {
  const e=parser.parseLine('192.0.2.1 - - [06/Nov/2026:09:00:00 +0000] "GET /api/orders?a=1 HTTP/1.1" 503 214 "-" "Demo"');
  assert.equal(e.level,'ERROR');assert.equal(e.fields.status,503);assert.equal(e.fields.path,'/api/orders?a=1');
  assert.equal(parser.parseLine('192.0.2.1 - - [06/Nov/2026:09:00:00 +0000] "GET / HTTP/1.1" 404 -').level,'WARN');
});
test('syslog events retain hostname and process', () => {
  const e=parser.parseLine('Nov  6 09:00:00 host1 worker[42]: ERROR Job failed');
  assert.equal(e.format,'syslog');assert.equal(e.logger,'host1 / worker[42]');assert.equal(e.level,'ERROR');assert.equal(e.message,'Job failed');
});
test('stack traces join the preceding event and preserve source line range', async () => {
  const text='2026-11-06T09:00:00Z ERROR failed\nTraceback (most recent call last):\n  File "a.py", line 1\nTimeoutError: failed\n2026-11-06T09:00:01Z INFO recovered';
  const {entries}=await parse(text);assert.equal(entries.length,2);assert.equal(entries[0].lineEnd,4);assert.ok(entries[0].message.includes('TimeoutError'));assert.equal(entries[1].lineStart,5);
});
test('JSON Lines rows do not absorb following text', async () => {
  const {entries}=await parse('{"level":"error","msg":"one"}\n    next raw event');assert.equal(entries.length,2);
});
test('empty input and blank lines do not manufacture entries', async () => {
  assert.equal((await parse('')).entries.length,0);const r=await parse('\n\nplain\n\n');assert.equal(r.entries.length,1);assert.equal(r.entries[0].lineStart,3);assert.equal(r.blankLines,3);
});
test('CRLF and BOM are accepted', async () => {
  const r=await parse('\uFEFFINFO one\r\nERROR two\r\n');assert.equal(r.entries.length,2);assert.equal(r.entries[1].level,'ERROR');assert.equal(r.totalLines,2);
});
test('source files never merge events, even with duplicate names', async () => {
  const r=await parser.parseSources([{name:'same.log',text:'ERROR one'},{name:'same.log',text:'  standalone'}]);assert.equal(r.entries.length,2);assert.equal(r.entries[1].sourceId,'1');assert.equal(parser.filterEntries(r.entries,{source:'1'}).length,1);
});
test('literal search does not execute regular expressions', async () => {
  const {entries}=await parse('INFO [abc] literal\nERROR abc plain');assert.equal(parser.filterEntries(entries,{query:'[abc]'}).length,1);assert.equal(parser.filterEntries(entries,{query:'ABC',severity:'ERROR'}).length,1);
});
test('search covers JSON fields and stack trace continuations', async () => {
  const {entries}=await parse('{"msg":"one","request_id":"hidden-id"}\nERROR timeout\n  stack-frame');assert.equal(parser.filterEntries(entries,{query:'hidden-id'}).length,1);assert.equal(parser.filterEntries(entries,{query:'stack-frame'}).length,1);
});
test('HTML payload is kept as data', async () => {
  const payload='<img src=x onerror=alert(1)>';const r=await parse(payload);assert.equal(r.entries[0].message,payload);assert.equal(r.entries[0].raw,payload);
});
test('CSV quotes newlines and commas and protects formula-leading cells', async () => {
  const entries=(await parse('=HYPERLINK("x","y")\nINFO text, with comma\n  next line')).entries;
  const csv=parser.toCsv(entries);assert.ok(csv.includes('"\'=HYPERLINK(""x"",""y"")"'));assert.ok(csv.includes('"text, with comma\n  next line"'));assert.ok(csv.includes('\r\n'));
});
test('binary text fails clearly', async () => {
  await assert.rejects(parse('a\u0000b'),/binary/);
});
test('non-object JSON array values fail clearly', async () => {
  await assert.rejects(parse('[{"msg":"ok"},null]'),/objects only/);
});
test('file count is bounded', async () => {
  await assert.rejects(parser.parseSources(Array.from({length:13},()=>({name:'a',text:'x'}))),/12 files/);
});
test('input bytes and event count are bounded without truncation', async () => {
  await assert.rejects(parse('x'.repeat(parser.MAX_BYTES+1)),/20 MB/);
  await assert.rejects(parse('INFO event\n'.repeat(parser.MAX_EVENTS+1)),/100,000 events/);
});
test('source line count is bounded', async () => {
  await assert.rejects(parse('\n'.repeat(parser.MAX_LINES+1)),/200,000 lines/);
});
test('parser factory can run independently in a worker context', async () => {
  const worker=vm.runInNewContext('('+vm.runInNewContext(core+'\ncreateLogParser').toString()+')()', {TextEncoder});
  assert.equal((await worker.parseSources([{name:'worker',text:'INFO ok'}])).entries[0].level,'INFO');
});
test('nested logger names are extracted', () => {
  assert.equal(parser.parseLine('{"logger":{"name":"payments"},"msg":"ok"}').logger,'payments');
});
test('long unrecognized input stays available as text', () => {
  const raw='prefix'+' '.repeat(100000)+'suffix';assert.equal(parser.parseLine(raw).raw,raw);
});
test('UI script compiles and HTML follows App Foundry single-file requirements', () => {
  new vm.Script(html.match(/<script id="app-ui">([\s\S]*?)<\/script>/)[1]);
  assert.ok(html.includes('https://cdn.tailwindcss.com'));
  assert.ok(!/<img[^>]+src="https?:/i.test(html));
  const ui=html.match(/<script id="app-ui">([\s\S]*?)<\/script>/)[1];
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\bfetch\(/.test(ui));
});
