import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_BASE_URL,
  ElevenLabsClient,
  ElevenLabsError,
  MAX_AUDIO_BYTES,
  describeError,
} from '../src/elevenlabs/client.js';

const KEY = 'sk_0123456789abcdef0123456789abcdef';
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
const SETTINGS = { speed: 1, stability: 0.5 };

// Records every request and answers with `respond(url, init)`.
function fakeFetch(respond) {
  const fetchImpl = async (url, init) => {
    fetchImpl.requests.push({ url, ...init });
    return respond(url, init);
  };
  fetchImpl.requests = [];
  return fetchImpl;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const audio = (bytes, contentType = 'audio/mpeg') =>
  new Response(bytes, { status: 200, headers: { 'Content-Type': contentType } });

const newClient = (respond, options = {}) => {
  const fetchImpl = fakeFetch(respond);
  return { client: new ElevenLabsClient({ apiKey: KEY, fetchImpl, ...options }), fetchImpl };
};

const failure = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('the promise resolved');
};

const synthesis = (client, overrides = {}) =>
  client.synthesize({
    voiceId: VOICE_ID,
    text: 'Bonjour',
    modelId: 'eleven_flash_v2_5',
    languageCode: 'fr',
    voiceSettings: SETTINGS,
    ...overrides,
  });

test('synthesize posts the text, model, language and settings, and returns the MP3', async () => {
  const mp3 = Buffer.from('ID3-fake-mp3');
  const { client, fetchImpl } = newClient(() => audio(mp3));

  const clip = await synthesis(client);

  assert.deepEqual(clip, mp3);
  const [request] = fetchImpl.requests;
  assert.equal(
    request.url,
    `${API_BASE_URL}/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
  );
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['xi-api-key'], KEY);
  assert.equal(request.headers.Accept, 'audio/mpeg');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.body), {
    text: 'Bonjour',
    model_id: 'eleven_flash_v2_5',
    voice_settings: SETTINGS,
    language_code: 'fr',
  });
});

test('synthesize leaves the language out when there is none', async () => {
  const { client, fetchImpl } = newClient(() => audio(Buffer.from('mp3')));

  await synthesis(client, { languageCode: undefined });

  assert.equal('language_code' in JSON.parse(fetchImpl.requests[0].body), false);
});

test('synthesize refuses an answer that is not audio', async () => {
  for (const response of [
    () => json(200, { ok: true }),
    () => audio(Buffer.alloc(0)),
    () => new Response('mp3', { status: 200 }),
  ]) {
    const { client } = newClient(response);
    const err = await failure(synthesis(client));
    assert.equal(err.kind, 'invalid_response');
  }
});

test('synthesize refuses a clip Gladys would refuse', async () => {
  const { client } = newClient(() => audio(Buffer.alloc(MAX_AUDIO_BYTES + 1)));

  const err = await failure(synthesis(client));

  assert.equal(err.kind, 'too_large');
});

test('getSubscription returns the credits and the reset time in ms', async () => {
  const { client, fetchImpl } = newClient(() =>
    json(200, {
      character_count: 1200,
      character_limit: 10000,
      next_character_count_reset_unix: 1767225600,
    }),
  );

  assert.deepEqual(await client.getSubscription(), {
    used: 1200,
    limit: 10000,
    resetAt: 1767225600000,
  });
  assert.equal(fetchImpl.requests[0].url, `${API_BASE_URL}/v1/user/subscription`);
  assert.equal(fetchImpl.requests[0].method, 'GET');
  assert.equal(fetchImpl.requests[0].body, undefined);
});

test('getSubscription without a reset time', async () => {
  const { client } = newClient(() => json(200, { character_count: 1, character_limit: 2 }));

  assert.equal((await client.getSubscription()).resetAt, null);
});

test('getVoice returns the voice fields', async () => {
  const { client, fetchImpl } = newClient(() =>
    json(200, { voice_id: VOICE_ID, name: 'George', category: 'premade', labels: {} }),
  );

  assert.deepEqual(await client.getVoice(VOICE_ID), {
    id: VOICE_ID,
    name: 'George',
    category: 'premade',
  });
  assert.equal(fetchImpl.requests[0].url, `${API_BASE_URL}/v1/voices/${VOICE_ID}`);
});

test('searchVoices sends the search and the page token, and returns the next one', async () => {
  const { client, fetchImpl } = newClient(() =>
    json(200, {
      voices: [{ voice_id: VOICE_ID, name: 'George' }],
      has_more: true,
      next_page_token: 'page-2',
    }),
  );

  const page = await client.searchVoices({ search: 'Geo rge', nextPageToken: 'page-1' });

  assert.deepEqual(page, {
    voices: [{ id: VOICE_ID, name: 'George', category: '' }],
    nextPageToken: 'page-2',
  });
  const url = new URL(fetchImpl.requests[0].url);
  assert.equal(url.pathname, '/v2/voices');
  assert.equal(url.searchParams.get('search'), 'Geo rge');
  assert.equal(url.searchParams.get('next_page_token'), 'page-1');
  assert.equal(url.searchParams.get('page_size'), '100');
  assert.equal(url.searchParams.get('include_total_count'), 'false');
});

test('searchVoices on the last page, or a page without voices', async () => {
  const { client } = newClient(() => json(200, { has_more: false, next_page_token: 'stale' }));

  assert.deepEqual(await client.searchVoices(), { voices: [], nextPageToken: null });
});

test('listVoices reads the pages until the last one', async () => {
  const pages = [
    { voices: [{ voice_id: 'a', name: 'A' }], has_more: true, next_page_token: 't2' },
    { voices: [{ voice_id: 'b', name: 'B' }], has_more: false, next_page_token: null },
  ];
  const { client, fetchImpl } = newClient(() => json(200, pages[fetchImpl.requests.length - 1]));

  const result = await client.listVoices();

  assert.deepEqual(
    result.voices.map((voice) => voice.id),
    ['a', 'b'],
  );
  assert.equal(result.truncated, false);
  assert.equal(new URL(fetchImpl.requests[1].url).searchParams.get('next_page_token'), 't2');
});

test('listVoices stops at the maximum', async () => {
  const { client, fetchImpl } = newClient(() =>
    json(200, {
      voices: [
        { voice_id: 'a', name: 'A' },
        { voice_id: 'b', name: 'B' },
      ],
      has_more: true,
      next_page_token: 'more',
    }),
  );

  const result = await client.listVoices({ max: 3 });

  assert.equal(fetchImpl.requests.length, 2);
  assert.equal(result.voices.length, 3);
  assert.equal(result.truncated, true);
});

test('API errors are classified from the status and the code', async () => {
  const cases = [
    [401, { detail: { code: 'invalid_api_key', message: 'Invalid API key' } }, 'invalid_key'],
    // What ElevenLabs really answers to a restricted key missing a permission.
    [
      401,
      {
        detail: {
          status: 'unauthorized',
          message:
            'The API key you used is missing the permission voices_read to execute this operation.',
        },
      },
      'permission',
    ],
    [401, { detail: { code: 'unauthorized' } }, 'invalid_key'],
    [401, { detail: { status: 'quota_exceeded', message: 'quota' } }, 'credits'],
    [402, { detail: { code: 'insufficient_credits' } }, 'credits'],
    [403, { detail: { code: 'model_access_denied' } }, 'permission'],
    [404, { detail: { code: 'voice_not_found' } }, 'voice_not_found'],
    [404, null, 'voice_not_found'],
    [404, { detail: { code: 'not_found' } }, 'invalid_request'],
    [429, { detail: { code: 'concurrent_limit_exceeded' } }, 'rate_limited'],
    [422, { detail: [{ loc: ['body', 'text'], msg: 'field required' }] }, 'invalid_request'],
    [400, { detail: 'bad' }, 'invalid_request'],
    [503, { detail: { code: 'maintenance' } }, 'server'],
    [302, null, 'server'],
  ];
  for (const [status, body, kind] of cases) {
    const { client } = newClient(() =>
      body === null ? new Response('<html>', { status }) : json(status, body),
    );
    const err = await failure(client.getVoice(VOICE_ID));
    assert.ok(err instanceof ElevenLabsError);
    assert.equal(err.kind, kind, `HTTP ${status} ${JSON.stringify(body)}`);
    assert.equal(err.status, status);
  }
});

test('the error message carries the code and the text of ElevenLabs', async () => {
  const { client } = newClient(() =>
    json(422, { detail: [{ loc: ['body', 'text'], msg: 'field required' }, {}] }),
  );

  const err = await failure(client.getVoice(VOICE_ID));

  assert.equal(err.message, `GET /v1/voices/${VOICE_ID}: HTTP 422 (field required)`);
  const coded = await failure(
    newClient(() =>
      json(403, { detail: { code: 'model_access_denied', message: 'No access' } }),
    ).client.getSubscription(),
  );
  assert.equal(coded.code, 'model_access_denied');
  assert.match(coded.message, /HTTP 403 \(model_access_denied: No access\)$/);
});

test('the API key never appears in an error, nor the searched text in its label', async () => {
  const { client } = newClient(() =>
    json(401, { detail: { code: 'invalid_api_key', message: `Key ${KEY} is invalid` } }),
  );

  const err = await failure(client.searchVoices({ search: 'my secret voice' }));

  assert.equal(err.message.includes(KEY), false);
  assert.equal(err.message.includes('secret'), false);
  assert.match(
    err.message,
    /^GET \/v2\/voices: HTTP 401 \(invalid_api_key: Key \*\*\* is invalid\)$/,
  );
});

test('a 2xx that is not JSON is an invalid response', async () => {
  const { client } = newClient(() => new Response('<html>portal</html>', { status: 200 }));

  const err = await failure(client.getSubscription());

  assert.equal(err.kind, 'invalid_response');
});

test('network failures are classified, keeping only the system code', async () => {
  const unreachable = await failure(
    newClient(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', key: KEY } });
    }).client.getSubscription(),
  );
  assert.equal(unreachable.kind, 'unreachable');
  assert.equal(unreachable.code, 'ENOTFOUND');
  assert.equal(unreachable.cause, undefined);
  assert.match(unreachable.message, /\(ENOTFOUND\)$/);

  const bare = await failure(
    newClient(() => {
      throw new Error('socket');
    }).client.getSubscription(),
  );
  assert.equal(bare.kind, 'unreachable');
  assert.equal(bare.code, undefined);

  const timeout = await failure(
    newClient(() => {
      throw new DOMException('timed out', 'TimeoutError');
    }).client.getSubscription(),
  );
  assert.equal(timeout.kind, 'timeout');
});

test('the synthesis gets its own, longer deadline', async () => {
  let signal;
  const { client } = newClient(
    (_url, init) => {
      signal = init.signal;
      return new Promise((resolve, reject) => {
        // AbortSignal.timeout does not keep the process alive: this does.
        const keepAlive = setTimeout(() => {}, 5000);
        init.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(init.signal.reason);
        });
      });
    },
    { synthesisTimeoutMs: 20 },
  );

  const err = await failure(synthesis(client));

  assert.equal(err.kind, 'timeout');
  assert.ok(signal.aborted);
});

test('describeError gives an actionable message for every kind', () => {
  const kinds = [
    'invalid_key',
    'permission',
    'credits',
    'voice_not_found',
    'rate_limited',
    'timeout',
    'unreachable',
    'too_large',
    'invalid_request',
    'server',
  ];
  for (const kind of kinds) {
    const message = describeError(new ElevenLabsError(kind, 'detail'));
    assert.ok(message.en && message.fr, kind);
  }
  assert.match(
    describeError(new ElevenLabsError('permission', 'x', { code: 'model_access_denied' })).fr,
    /\(model_access_denied\)/,
  );
  assert.deepEqual(describeError(new Error('other')), describeError(undefined));
});
