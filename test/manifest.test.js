// -----------------------------------------------------------------------------
// The manifest and the code state some facts twice (the configuration keys,
// their defaults and ranges, the models, the action key, the version).
// Nothing links them at runtime, and a divergence fails at the worst possible
// moment. These tests are that link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { DEFAULTS, MODELS, SPEED_RANGE, STABILITY_RANGE, normalizeConfig } from '../src/config.js';
import { ElevenLabsIntegration } from '../src/integration.js';

const MAX_COVER_BYTES = 150 * 1024;
// INTEGRATION_CATALOG_CATEGORIES in the core. The manifest schema has no enum
// (an unknown key is dropped with a warning), so a typo here would silently
// land the integration in the uncategorized bucket.
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

const readJson = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const manifest = readJson('gladys-assistant-integration.json');
const pkg = readJson('package.json');
const valueKeys = (schema) =>
  schema.filter((field) => field.type !== 'section').map((field) => field.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

test('the manifest version matches package.json and the image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/cicoub13/gladys-elevenlabs:${manifest.version}`);
});

test('the manifest is a text-to-speech provider for Gladys 5.3 and later', () => {
  assert.equal(manifest.type, 'tts');
  // The `tts` type and `keywords` both arrived in Gladys 5.3.0.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.equal(manifest.messaging, undefined);
  assert.equal(manifest.contact_schema, undefined);
});

test('the name, descriptions and keywords fit the store limits', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} is ${text.length} chars`,
    );
  }
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10);
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
  const lowered = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(lowered).size, lowered.length);
});

test('the catalog category is the voice assistants shelf', () => {
  // capabilities/tts-type.md: a TTS provider declares `assistants`.
  assert.deepEqual(manifest.categories, ['assistants']);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown catalog category: ${category}`);
  }
});

test('the transport is declared for the catalog Local / Cloud filter', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('no permission or capability is declared that the integration does not use', () => {
  for (const key of [
    'location',
    'network_wake',
    'network_discovery',
    'containers',
    'webhooks',
    'widgets',
    'scene_triggers',
    'scene_actions',
  ]) {
    assert.equal(manifest[key], undefined, `${key} is declared but unused`);
  }
});

test('the configuration keys are the ones the code reads', () => {
  assert.deepEqual(valueKeys(manifest.config_schema), Object.keys(normalizeConfig({})));
});

test('the API key is a required secret, never a plain string', () => {
  assert.equal(field('api_key').type, 'secret');
  assert.equal(field('api_key').required, true);
});

test('the defaults, ranges and models of the form are the ones the code applies', () => {
  assert.equal(field('voice').default, DEFAULTS.voice);
  assert.equal(field('model').default, DEFAULTS.model);
  assert.deepEqual(
    field('model').options.map((option) => option.value),
    Object.keys(MODELS),
  );
  assert.equal(field('speed').default, DEFAULTS.speed);
  assert.deepEqual([field('speed').min, field('speed').max], [SPEED_RANGE.min, SPEED_RANGE.max]);
  assert.equal(field('stability').default, DEFAULTS.stability);
  assert.deepEqual(
    [field('stability').min, field('stability').max],
    [STABILITY_RANGE.min, STABILITY_RANGE.max],
  );
});

test('every declared action has a handler', async () => {
  const gladys = createFakeGladys();
  registerHandlers(gladys, new ElevenLabsIntegration(gladys));
  for (const action of manifest.actions) {
    const ack = await gladys.fake.action(action.key);
    assert.notEqual(ack.error, 'not implemented', action.key);
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
});

test('every text shown to the user is translated (en + fr)', () => {
  const entries = [...manifest.config_schema, ...manifest.actions];
  const nested = entries.flatMap((entry) => [...(entry.links ?? []), ...(entry.options ?? [])]);
  for (const entry of [...entries, ...nested]) {
    assert.ok(entry.label.en && entry.label.fr, `missing label on ${JSON.stringify(entry)}`);
  }
  for (const entry of entries) {
    for (const text of [entry.description, entry.placeholder].filter(Boolean)) {
      assert.ok(text.en && text.fr, `missing translation on ${entry.key}`);
    }
  }
});

test('the sections fit the core limits: 1000 characters, 5 https links', () => {
  const sections = manifest.config_schema.filter((entry) => entry.type === 'section');
  for (const section of sections) {
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} chars`);
    }
    assert.ok(section.links.length <= 5);
    for (const link of section.links) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the cover image is an 800 x 534 PNG within the store limit', () => {
  assert.ok(manifest.cover_image.endsWith('/cover.png'));
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.ok(png.length <= MAX_COVER_BYTES, `cover.png is ${png.length} bytes`);
  // PNG signature, then the IHDR chunk: width and height as big-endian uint32.
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [800, 534]);
});
