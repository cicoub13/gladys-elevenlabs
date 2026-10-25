import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, isVoiceId, languageCode, normalizeConfig } from '../src/config.js';

test('normalizeConfig trims the values and keeps valid settings', () => {
  assert.deepEqual(
    normalizeConfig({
      api_key: ' sk_123 ',
      voice: ' Sarah ',
      model: 'eleven_v3',
      speed: 1.1,
      stability: 0,
    }),
    { api_key: 'sk_123', voice: 'Sarah', model: 'eleven_v3', speed: 1.1, stability: 0 },
  );
});

test('normalizeConfig falls back to the defaults for missing or invalid values', () => {
  const expected = { api_key: '', ...DEFAULTS };
  assert.deepEqual(normalizeConfig(undefined), expected);
  assert.deepEqual(normalizeConfig(null), expected);
  assert.deepEqual(
    normalizeConfig({ api_key: 42, voice: '  ', model: 'eleven_v9', speed: 3, stability: -1 }),
    expected,
  );
  assert.deepEqual(normalizeConfig({ model: 'constructor', speed: NaN, stability: {} }), expected);
});

test('normalizeConfig accepts numbers sent as text', () => {
  const config = normalizeConfig({ speed: '0.9', stability: ' 0.75 ' });
  assert.equal(config.speed, 0.9);
  assert.equal(config.stability, 0.75);
  assert.equal(normalizeConfig({ speed: '' }).speed, DEFAULTS.speed);
  assert.equal(normalizeConfig({ speed: 'fast' }).speed, DEFAULTS.speed);
});

test('isVoiceId tells a voice id from a voice name', () => {
  assert.equal(isVoiceId('JBFqnCBsd6RMkjVDRZzb'), true);
  assert.equal(isVoiceId('George'), false);
  assert.equal(isVoiceId('JBFqnCBsd6RMkjVDRZz!'), false);
  assert.equal(isVoiceId('JBFqnCBsd6RMkjVDRZzbX'), false);
});

test('languageCode keeps the ISO 639-1 part for the models that take one', () => {
  assert.equal(languageCode('fr', 'eleven_flash_v2_5'), 'fr');
  assert.equal(languageCode('en-US', 'eleven_v3'), 'en');
  assert.equal(languageCode('PT_br', 'eleven_flash_v2_5'), 'pt');
});

test('languageCode sends nothing when the model detects the language or it is unknown', () => {
  assert.equal(languageCode('fr', 'eleven_multilingual_v2'), undefined);
  assert.equal(languageCode(null, 'eleven_flash_v2_5'), undefined);
  assert.equal(languageCode('french', 'eleven_flash_v2_5'), undefined);
  assert.equal(languageCode('fr', 'unknown_model'), undefined);
});
