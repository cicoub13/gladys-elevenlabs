import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipCache } from '../src/clip-cache.js';

const clip = (size) => Buffer.alloc(size, 1);

test('a stored clip is served again', () => {
  const cache = new ClipCache();
  cache.set('a', clip(10));
  assert.equal(cache.get('a').length, 10);
  assert.equal(cache.get('b'), undefined);
});

test('the least recently used clips are evicted beyond the byte budget', () => {
  const cache = new ClipCache({ maxBytes: 25, maxEntries: 10 });
  cache.set('a', clip(10));
  cache.set('b', clip(10));
  cache.get('a'); // a is now more recent than b
  cache.set('c', clip(10));
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
  assert.equal(cache.bytes, 20);
});

test('the number of clips is bounded too', () => {
  const cache = new ClipCache({ maxBytes: 1000, maxEntries: 2 });
  cache.set('a', clip(1));
  cache.set('b', clip(1));
  cache.set('c', clip(1));
  assert.deepEqual([...cache.clips.keys()], ['b', 'c']);
});

test('replacing a clip counts its size once, and a clip over the budget is not kept', () => {
  const cache = new ClipCache({ maxBytes: 20 });
  cache.set('a', clip(10));
  cache.set('a', clip(5));
  assert.equal(cache.bytes, 5);
  cache.set('a', clip(30));
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.bytes, 0);
});

test('clear forgets every clip', () => {
  const cache = new ClipCache();
  cache.set('a', clip(3));
  cache.clear();
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.bytes, 0);
});

test('the key changes with everything that changes the audio', () => {
  const base = {
    voiceId: 'v',
    text: 'Hello',
    modelId: 'm',
    languageCode: 'en',
    voiceSettings: { speed: 1, stability: 0.5 },
  };
  const keys = new Set([
    ClipCache.key(base),
    ClipCache.key({ ...base, voiceId: 'w' }),
    ClipCache.key({ ...base, text: 'Hi' }),
    ClipCache.key({ ...base, modelId: 'n' }),
    ClipCache.key({ ...base, languageCode: undefined }),
    ClipCache.key({ ...base, voiceSettings: { speed: 1.1, stability: 0.5 } }),
    ClipCache.key({ ...base, voiceSettings: { speed: 1, stability: 0.6 } }),
  ]);
  assert.equal(keys.size, 7);
  assert.equal(ClipCache.key({ ...base }), ClipCache.key(base));
});
