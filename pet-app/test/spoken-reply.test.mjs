import test from 'node:test';
import assert from 'node:assert/strict';
import { SpokenReplyDecoder } from '../spoken-reply.mjs';

function decode(chunks) {
  const emitted = [];
  const decoder = new SpokenReplyDecoder(text => emitted.push(text));
  for (const chunk of chunks) decoder.feed(chunk);
  const result = decoder.finish();
  assert.equal(emitted.join(''), result);
  for (const text of emitted) assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text));
  return result;
}

test('decodes escapes and Unicode at every split and one character at a time', () => {
  const source = ' {"opening":"Hi\\n\\\"you\\\"", "personal_voice":"我\\uD83D\\uDE00\\\\好😀", "continuation":"Bye\\t!"} \n';
  const expected = 'Hi\n"you"\n\n我😀\\好😀\n\nBye\t!';
  for (let split = 0; split <= source.length; split++) assert.equal(decode([source.slice(0, split), source.slice(split)]), expected);
  assert.equal(decode(source.split('')), expected);
});

test('emits speech before the first value closes', () => {
  const emitted = [];
  const decoder = new SpokenReplyDecoder(text => emitted.push(text));
  decoder.feed('{"opening":"Hello');
  assert.equal(emitted.join(''), 'Hello');
  decoder.feed('","personal_voice":"world"}');
  assert.equal(decoder.finish(), 'Hello\n\nworld');
});

test('optional empty or absent fields do not add separators', () => {
  for (const value of [ { personal_voice: 'yes' }, { opening: '', personal_voice: 'yes', continuation: '' }, { opening: '', personal_voice: 'yes', continuation: 'ok' } ]) {
    assert.equal(decode([JSON.stringify(value)]), Object.values(value).filter(Boolean).join('\n\n'));
  }
});

test('rejects malformed, invalid schema, duplicate, unordered and incomplete data', () => {
  const invalid = [ '', '{}', '[]', 'null', '{"personal_voice":""}', '{"personal_voice":"   "}', '{"opening":"hi"}', '{"personal_voice":3}', '{"personal_voice":null}', '{"personal_voice":{}}', '{"personal_voice":[]}', '{"other":"x","personal_voice":"a"}', '{"personal_voice":"a","personal_voice":"b"}', '{"personal_voice":"a","opening":"b"}', '{"continuation":"b","personal_voice":"a"}', '{"personal_voice":"a",}', '{"personal_voice":"a"}{}', '{"personal_voice":"a"} x', '{"personal_voice":"a', '{"personal_voice":"\\x"}', '{"personal_voice":"\\uZZZZ"}', '{"personal_voice":"a\nb"}', '{"personal_voice":"\\uD800"}', '{"personal_voice":"\\uDC00"}', '{"personal_voice":"\\uD800x"}', '{"personal_voice":"\uD800"}', '{"personal_voice":"\uDC00"}' ];
  for (const source of invalid) assert.throws(() => decode(source.split('')), undefined, JSON.stringify(source));
});

test('enforces output and input limits', () => {
  assert.equal(decode([JSON.stringify({personal_voice:'a'.repeat(8000)})]).length, 8000);
  assert.throws(() => decode([JSON.stringify({personal_voice:'a'.repeat(8001)})]));
  assert.throws(() => decode([' '.repeat(65537)]));
});
