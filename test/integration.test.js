// -----------------------------------------------------------------------------
// The integration driven like Gladys drives it: the handlers registered by
// registerHandlers() run on the SDK's in-memory Gladys (connection, speech
// requests, the "List my voices" button), with a scripted ElevenLabs client.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { ElevenLabsError, describeError } from '../src/elevenlabs/client.js';
import {
  ElevenLabsIntegration,
  MAX_LISTED_VOICES,
  MESSAGES,
  connectedMessage,
  matchesVoiceName,
  voicesMessage,
} from '../src/integration.js';

const KEY = 'sk_test_key';
const GEORGE = { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade' };
const SARAH = { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'premade' };
// Noon UTC: the same calendar day in every timezone the tests may run in.
const RESET_AT = Date.UTC(2026, 10, 12, 12);
const CREDITS = { used: 1500, limit: 10000, resetAt: RESET_AT };
const MP3 = Buffer.from('fake-mp3');
const CONFIG = { api_key: KEY, voice: 'George' };

const apiError = (kind, status) => new ElevenLabsError(kind, `${kind} detail`, { status });

// Resolves (or rejects with) the next outcome of a list; the last one repeats.
function script(outcomes, calls) {
  return (...args) => {
    calls.push(args);
    const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (typeof outcome === 'function') {
      return outcome(...args);
    }
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  };
}

function scriptedClient({
  search = [{ voices: [GEORGE, SARAH], nextPageToken: null }],
  voice = [GEORGE],
  subscription = [CREDITS],
  list = [{ voices: [SARAH, GEORGE], truncated: false }],
  synthesize = [MP3],
} = {}) {
  const calls = { search: [], voice: [], subscription: [], list: [], synthesize: [] };
  return {
    calls,
    searchVoices: script(search, calls.search),
    getVoice: script(voice, calls.voice),
    getSubscription: script(subscription, calls.subscription),
    listVoices: script(list, calls.list),
    synthesize: script(synthesize, calls.synthesize),
  };
}

async function setup({ clients = [scriptedClient()], config = CONFIG, connect = true } = {}) {
  const gladys = createFakeGladys({ config });
  const created = [];
  const logs = { info: [], warn: [], debug: [] };
  const logger = {
    info: (message) => logs.info.push(message),
    warn: (message) => logs.warn.push(message),
    debug: (message) => logs.debug.push(message),
  };
  const integration = new ElevenLabsIntegration(gladys, {
    logger,
    createClient: (options) => {
      const client = clients[Math.min(created.length, clients.length - 1)];
      created.push({ options, client });
      return client;
    },
  });
  registerHandlers(gladys, integration, { logger });
  if (connect) {
    await gladys.connect();
  }
  return { gladys, integration, created, logs, client: clients[0] };
}

const lastStatus = (gladys) => gladys.fake.connectionStatuses.at(-1);
const decode = (ack) => {
  assert.equal(ack.success, true, ack.error);
  const [type, data] = ack.data.audio.split(';base64,');
  assert.equal(type, 'audio/mpeg');
  return Buffer.from(data, 'base64');
};

test('without an API key, the status asks for one and nothing is requested', async () => {
  const { gladys, created } = await setup({ config: {} });

  assert.equal(created.length, 0);
  assert.deepEqual(lastStatus(gladys), { connected: false, message: MESSAGES.notConfigured });
  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.equal(ack.success, false);
  assert.equal(ack.error, MESSAGES.notConfigured.en);
  const action = await gladys.fake.action('list_voices');
  assert.equal(action.success, false);
  assert.equal(action.error, MESSAGES.notConfigured.en);
});

test('on connection, the voice is found by name and the status shows it with the credits', async () => {
  const { gladys, created, client } = await setup();

  assert.deepEqual(created[0].options, { apiKey: KEY });
  assert.deepEqual(client.calls.search, [[{ search: 'George' }]]);
  assert.deepEqual(lastStatus(gladys), {
    connected: true,
    message: connectedMessage(GEORGE, CREDITS),
  });
  assert.equal(
    lastStatus(gladys).message.fr,
    'Connecté à ElevenLabs, voix « George ». 8 500 crédits restants sur 10 000, renouvelés le 12 novembre.',
  );
  assert.equal(
    lastStatus(gladys).message.en,
    'Connected to ElevenLabs, voice "George". 8,500 of 10,000 credits left, renewed on 12 November.',
  );
});

test('a voice id is looked up directly', async () => {
  const client = scriptedClient();
  await setup({ clients: [client], config: { api_key: KEY, voice: GEORGE.id } });

  assert.deepEqual(client.calls.voice, [[GEORGE.id]]);
  assert.equal(client.calls.search.length, 0);
});

test('a default voice is found by the name before its description, an exact name first', async () => {
  const described = { id: 'aaaaaaaaaaaaaaaaaaaa', name: 'George - Warm, Captivating Storyteller' };
  const exact = { id: 'bbbbbbbbbbbbbbbbbbbb', name: 'george' };
  const client = scriptedClient({ search: [{ voices: [described, exact], nextPageToken: null }] });
  const { integration } = await setup({ clients: [client] });

  assert.equal(integration.voice.id, exact.id);

  const other = scriptedClient({ search: [{ voices: [SARAH, described], nextPageToken: null }] });
  const second = await setup({ clients: [other] });
  assert.equal(second.integration.voice.id, described.id);
});

test('matchesVoiceName ignores the case and the description of the name', () => {
  assert.equal(matchesVoiceName('George - Warm, Captivating', 'george'), true);
  assert.equal(matchesVoiceName(' Sarah ', 'sarah'), true);
  assert.equal(matchesVoiceName('Georgette', 'george'), false);
});

test('an unknown voice is reported and blocks the synthesis without a request', async () => {
  const client = scriptedClient({ search: [{ voices: [SARAH], nextPageToken: null }] });
  const { gladys } = await setup({ clients: [client] });

  const notFound = describeError(new ElevenLabsError('voice_not_found', ''));
  assert.deepEqual(lastStatus(gladys), { connected: false, message: notFound });
  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.equal(ack.success, false);
  assert.equal(ack.error, notFound.en);
  assert.equal(client.calls.synthesize.length, 0);
});

test('a refused API key is reported and blocks the synthesis', async () => {
  const client = scriptedClient({ search: [apiError('invalid_key', 401)] });
  const { gladys, logs } = await setup({ clients: [client] });

  const refused = describeError(apiError('invalid_key'));
  assert.deepEqual(lastStatus(gladys), { connected: false, message: refused });
  assert.ok(logs.warn.some((line) => line.startsWith('ElevenLabs check failed')));
  const ack = await gladys.fake.ttsSynthesize('Bonjour', null);
  assert.equal(ack.error, refused.en);
  assert.equal(client.calls.synthesize.length, 0);
});

test('a key that cannot read voices still speaks with a voice id', async () => {
  const client = scriptedClient({
    voice: [apiError('permission', 403)],
    subscription: [apiError('permission', 403)],
  });
  const { gladys } = await setup({ clients: [client], config: { api_key: KEY, voice: GEORGE.id } });

  assert.deepEqual(lastStatus(gladys), {
    connected: true,
    message: connectedMessage({ name: GEORGE.id }, null),
  });
  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));
  assert.equal(client.calls.synthesize[0][0].voiceId, GEORGE.id);
});

test('a key that cannot read voices asks for a voice id instead of a name', async () => {
  const client = scriptedClient({ search: [apiError('permission', 403)] });
  const { gladys } = await setup({ clients: [client] });

  assert.deepEqual(lastStatus(gladys), { connected: false, message: MESSAGES.voiceNeedsId });
  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.equal(ack.error, MESSAGES.voiceNeedsId.en);
});

test('a lookup that fails for another reason is passed on', async () => {
  const client = scriptedClient({ voice: [apiError('server', 500)] });
  const { gladys } = await setup({ clients: [client], config: { api_key: KEY, voice: GEORGE.id } });

  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: describeError(apiError('server')),
  });
});

test('the status shows the voice alone when the credits cannot be read', async () => {
  const client = scriptedClient({ subscription: [apiError('permission', 403)] });
  const { gladys, logs } = await setup({ clients: [client] });

  assert.deepEqual(lastStatus(gladys), {
    connected: true,
    message: connectedMessage(GEORGE, null),
  });
  assert.ok(logs.debug.some((line) => line.startsWith('ElevenLabs credits not read')));
});

test('connectedMessage without a reset date', () => {
  const message = connectedMessage(GEORGE, { used: 12000, limit: 10000, resetAt: null });
  assert.equal(message.en, 'Connected to ElevenLabs, voice "George". 0 of 10,000 credits left.');
});

test('a speech request returns the MP3 made with the configured voice and settings', async () => {
  const client = scriptedClient();
  const { gladys } = await setup({
    clients: [client],
    config: { ...CONFIG, model: 'eleven_v3', speed: 1.1, stability: 0.3 },
  });

  const clip = decode(await gladys.fake.ttsSynthesize('  La porte est ouverte  ', 'fr-FR'));

  assert.deepEqual(clip, MP3);
  assert.deepEqual(client.calls.synthesize, [
    [
      {
        voiceId: GEORGE.id,
        text: 'La porte est ouverte',
        modelId: 'eleven_v3',
        languageCode: 'fr',
        voiceSettings: { speed: 1.1, stability: 0.3 },
      },
    ],
  ]);
});

test('a sentence already spoken is served from memory, without credits', async () => {
  const client = scriptedClient();
  const { gladys, logs } = await setup({ clients: [client] });

  decode(await gladys.fake.ttsSynthesize('Le dîner est prêt', 'fr'));
  decode(await gladys.fake.ttsSynthesize('Le dîner est prêt', 'fr'));
  decode(await gladys.fake.ttsSynthesize('Le dîner est prêt', 'en'));

  assert.equal(client.calls.synthesize.length, 2);
  assert.ok(logs.debug.some((line) => line.startsWith('Clip served from memory')));
});

test('identical requests at the same time share one synthesis', async () => {
  let resolveClip;
  const client = scriptedClient({
    synthesize: [() => new Promise((resolve) => (resolveClip = resolve))],
  });
  const { gladys } = await setup({ clients: [client] });

  const acks = [
    gladys.fake.ttsSynthesize('Alerte', 'fr'),
    gladys.fake.ttsSynthesize('Alerte', 'fr'),
    gladys.fake.ttsSynthesize('Alerte', 'fr'),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  resolveClip(MP3);

  for (const ack of await Promise.all(acks)) {
    assert.deepEqual(decode(ack), MP3);
  }
  assert.equal(client.calls.synthesize.length, 1);
  assert.equal(gladys.fake.wsMessages.length > 0, true);
});

test('an empty text fails without a request', async () => {
  const { gladys, client } = await setup();

  const ack = await gladys.fake.ttsSynthesize('   ', 'fr');

  assert.equal(ack.success, false);
  assert.match(ack.error, /Empty text/);
  assert.equal(client.calls.synthesize.length, 0);
});

test('a new configuration uses a new client and forgets the clips of the old voice', async () => {
  const first = scriptedClient();
  const second = scriptedClient({ search: [{ voices: [SARAH], nextPageToken: null }] });
  const { gladys, created } = await setup({ clients: [first, second] });
  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));

  await gladys.fake.configUpdated({ api_key: 'sk_other', voice: 'sarah' });
  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));

  assert.deepEqual(created[1].options, { apiKey: 'sk_other' });
  assert.equal(second.calls.synthesize.length, 1);
  assert.equal(second.calls.synthesize[0][0].voiceId, SARAH.id);
  assert.equal(lastStatus(gladys).message.en.includes('"Sarah"'), true);
});

test('used-up credits are reported, and the status recovers after a success', async () => {
  const client = scriptedClient({ synthesize: [apiError('credits', 402), MP3] });
  const { gladys } = await setup({ clients: [client] });

  const failed = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.equal(failed.success, false);
  assert.ok(failed.error.startsWith(describeError(apiError('credits')).en));
  assert.ok(failed.error.endsWith('[credits detail]'));
  assert.deepEqual(lastStatus(gladys), {
    connected: false,
    message: describeError(apiError('credits')),
  });

  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));
  assert.deepEqual(lastStatus(gladys), {
    connected: true,
    message: connectedMessage(GEORGE, CREDITS),
  });
});

test('too many requests at once fail that request only', async () => {
  const client = scriptedClient({ synthesize: [apiError('rate_limited', 429)] });
  const { gladys, logs } = await setup({ clients: [client] });
  const statuses = gladys.fake.connectionStatuses.length;

  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');

  assert.equal(ack.success, false);
  assert.equal(gladys.fake.connectionStatuses.length, statuses);
  assert.ok(logs.warn.some((line) => line.startsWith('Speech not synthesized')));
});

test('a voice deleted from the account blocks the synthesis until the configuration changes', async () => {
  const client = scriptedClient({ synthesize: [apiError('voice_not_found', 404)] });
  const { gladys } = await setup({ clients: [client] });

  await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  const ack = await gladys.fake.ttsSynthesize('Bonsoir', 'fr');

  assert.equal(client.calls.synthesize.length, 1);
  assert.equal(ack.error, describeError(apiError('voice_not_found')).en);
});

test('a voice lookup that failed on a network error is retried by the next request', async () => {
  const client = scriptedClient({
    search: [apiError('unreachable'), { voices: [GEORGE], nextPageToken: null }],
  });
  const { gladys } = await setup({ clients: [client] });
  assert.equal(lastStatus(gladys).connected, false);

  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));

  assert.equal(client.calls.search.length, 2);
  assert.deepEqual(lastStatus(gladys), {
    connected: true,
    message: connectedMessage(GEORGE, null),
  });
});

test('a lookup failing during a request fails that request', async () => {
  const client = scriptedClient({ search: [apiError('unreachable')] });
  const { gladys } = await setup({ clients: [client] });

  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');

  assert.equal(ack.success, false);
  assert.ok(ack.error.startsWith(describeError(apiError('unreachable')).en));
});

test('a request arriving before the configuration was resynchronized reads it', async () => {
  const client = scriptedClient();
  const { gladys, created } = await setup({ clients: [client], connect: false });

  const acks = await Promise.all([
    gladys.fake.ttsSynthesize('Bonjour', 'fr'),
    gladys.fake.ttsSynthesize('Bonsoir', 'fr'),
  ]);

  acks.forEach(decode);
  assert.equal(created.length, 1);
  assert.equal(gladys.fake.requests.filter((request) => request.path === '/config').length, 1);
});

test('a failed configuration read is tried again by the next request', async (t) => {
  const { gladys, integration } = await setup({ connect: false });
  const getConfig = t.mock.method(gladys, 'getConfig', async () => {
    throw new Error('host API down');
  });

  const ack = await gladys.fake.ttsSynthesize('Bonjour', 'fr');
  assert.equal(ack.success, false);
  assert.equal(integration.loading, null);

  getConfig.mock.restore();
  decode(await gladys.fake.ttsSynthesize('Bonjour', 'fr'));
});

test('the outcome of a request made with an old configuration changes nothing', async () => {
  let resolveClip;
  const first = scriptedClient({
    synthesize: [() => new Promise((resolve) => (resolveClip = resolve))],
  });
  const second = scriptedClient({ synthesize: [apiError('credits', 402)] });
  const { gladys, integration } = await setup({ clients: [first, second] });

  const pending = gladys.fake.ttsSynthesize('Bonjour', 'fr');
  await new Promise((resolve) => setImmediate(resolve));
  await gladys.fake.configUpdated({ api_key: 'sk_other', voice: 'George' });
  resolveClip(MP3);

  decode(await pending);
  assert.equal(integration.cache.clips.size, 0);
});

test('"List my voices" shows every voice, sorted, the one in use marked', async () => {
  const { gladys, client } = await setup();

  const ack = await gladys.fake.action('list_voices');

  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(client.calls.list, [[{ max: MAX_LISTED_VOICES }]]);
  assert.equal(
    ack.data.message.fr,
    '2 voix dans votre compte ElevenLabs. Copiez un nom ou un identifiant dans le champ Voix, puis enregistrez.\n\n' +
      `✓ George — ${GEORGE.id} (premade)\n• Sarah — ${SARAH.id} (premade)`,
  );
});

test('voicesMessage says when the list is cut or empty', () => {
  const cut = voicesMessage({ voices: [{ id: 'x', name: 'X', category: '' }], truncated: true });
  assert.match(cut.en, /Only the first 1 are listed\./);
  assert.match(cut.en, /• X — x$/);
  assert.match(voicesMessage({ voices: [], truncated: false }).fr, /aucune voix/);
});

test('"List my voices" reports why the voices cannot be read', async () => {
  const client = scriptedClient({ list: [apiError('invalid_key', 401)] });
  const { gladys } = await setup({ clients: [client] });

  const ack = await gladys.fake.action('list_voices');

  assert.equal(ack.success, false);
  assert.ok(ack.error.startsWith(describeError(apiError('invalid_key')).en));
});

test('the status is published only when it changes, and a failure to publish is logged', async (t) => {
  const { gladys, integration, logs } = await setup();
  const count = gladys.fake.connectionStatuses.length;

  await integration.reportConnection(true, connectedMessage(GEORGE, CREDITS));
  assert.equal(gladys.fake.connectionStatuses.length, count);

  t.mock.method(gladys, 'setConnectionStatus', async () => {
    throw new Error('host API down');
  });
  await integration.reportConnection(false, MESSAGES.notConfigured);
  assert.ok(logs.warn.includes('Unable to publish the connection status: host API down'));
});

test('a new configuration is logged and applied', async () => {
  const { gladys, logs, created } = await setup();

  await gladys.fake.configUpdated({});

  assert.ok(logs.info.includes('onConfigUpdated -> new configuration received'));
  assert.equal(created.length, 1);
  assert.deepEqual(lastStatus(gladys), { connected: false, message: MESSAGES.notConfigured });
});
