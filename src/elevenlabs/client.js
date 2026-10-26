// -----------------------------------------------------------------------------
// Minimal ElevenLabs API client (https://elevenlabs.io/docs/api-reference):
// synthesize a text, look up voices, read the credits of the subscription.
//
// Every failure is thrown as an ElevenLabsError whose `kind` tells what went
// wrong, so callers can turn it into an actionable message with
// describeError(). The API key is kept in a private field and scrubbed from
// anything ElevenLabs sends back: the client object and its errors can be
// logged safely. `fetchImpl` is injectable so unit tests never touch the real
// network.
// -----------------------------------------------------------------------------

export const API_BASE_URL = 'https://api.elevenlabs.io';

// Voice lookups and the subscription answer in well under a second.
export const DEFAULT_TIMEOUT_MS = 10 * 1000;
// Gladys gives up on a synthesis after 30 s (TTS_SYNTHESIZE_TIMEOUT_MS in the
// core): answer before that, with our own error rather than its timeout.
export const SYNTHESIS_TIMEOUT_MS = 25 * 1000;
// The core refuses a clip over 5 MB (MAX_TTS_AUDIO_SIZE_BYTES). At 128 kbit/s
// that is over 5 minutes of speech, far more than its 2,000 characters.
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
// MP3 is what every speaker plays; 128 kbit/s is available on every plan.
export const OUTPUT_FORMAT = 'mp3_44100_128';
// The /v2/voices pages hold at most 100 voices.
const VOICES_PAGE_SIZE = 100;

/**
 * Error of an ElevenLabs request.
 * `kind`: 'unreachable' | 'timeout' | 'invalid_key' | 'permission' |
 * 'credits' | 'voice_not_found' | 'rate_limited' | 'invalid_request' |
 * 'server' | 'invalid_response' | 'too_large'.
 */
export class ElevenLabsError extends Error {
  /**
   * @param {string} kind - Failure category.
   * @param {string} message - Technical message (never contains the key).
   * @param {{status?: number, code?: string}} [details] - HTTP status, ElevenLabs or system error code.
   */
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'ElevenLabsError';
    this.kind = kind;
    if (status !== undefined) {
      this.status = status;
    }
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Convert a rejection of fetch (or of the body read) into an ElevenLabsError.
 * Only the system error code is kept: the original error is dropped rather
 * than chained, so nothing from the request can leak through it.
 * @param {unknown} err - What fetch threw.
 * @param {string} label - `METHOD /path` of the request.
 * @returns {ElevenLabsError} The normalized error.
 */
function networkError(err, label) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new ElevenLabsError('timeout', `${label}: ElevenLabs did not answer in time`);
  }
  // undici wraps the system error: TypeError('fetch failed', { cause }).
  const code = err?.cause?.code ?? err?.code;
  const suffix = typeof code === 'string' ? ` (${code})` : '';
  return new ElevenLabsError('unreachable', `${label}: ElevenLabs is unreachable${suffix}`, {
    code: typeof code === 'string' ? code : undefined,
  });
}

/**
 * The code and the text of an error body. ElevenLabs answers
 * `{"detail": {"code", "message", "status"}}` (`status` is the legacy name of
 * `code`), a plain `{"detail": "text"}` on older endpoints, and a list of
 * `{loc, msg}` on a validation error.
 * @param {any} body - Parsed JSON body, or null.
 * @returns {{code?: string, text: string}} What the error says.
 */
function errorDetail(body) {
  const detail = body?.detail;
  if (typeof detail === 'string') {
    return { text: detail };
  }
  if (Array.isArray(detail)) {
    return {
      text: detail
        .map((entry) => entry?.msg)
        .filter(Boolean)
        .join('; '),
    };
  }
  const code = [detail?.code, detail?.status].find((value) => typeof value === 'string');
  return { code, text: typeof detail?.message === 'string' ? detail.message : '' };
}

// Codes ElevenLabs uses for an exhausted credit balance: 402
// `insufficient_credits`, and the older 401 `quota_exceeded`.
const CREDIT_CODES = ['insufficient_credits', 'quota_exceeded'];
// A restricted key missing a permission gets a 401, not the documented 403:
// `{"code": "unauthorized", "message": "The API key you used is missing the
// permission user_read to execute this operation."}`. Only its text tells it
// from a wrong key.
const MISSING_PERMISSION = /\bpermission/i;

/**
 * Turn a non-2xx answer into an ElevenLabsError.
 * @param {string} label - `METHOD /path` of the request.
 * @param {number} status - HTTP status.
 * @param {any} body - Parsed JSON body, or null.
 * @param {(text: string) => string} redact - Removes the key from a text.
 * @returns {ElevenLabsError} The normalized error.
 */
function apiError(label, status, body, redact) {
  const { code, text } = errorDetail(body);
  const detail = [code, redact(text)].filter(Boolean).join(': ');
  const message = `${label}: HTTP ${status}${detail ? ` (${detail})` : ''}`;
  const details = { status, code };
  if (status === 402 || CREDIT_CODES.includes(code)) {
    return new ElevenLabsError('credits', message, details);
  }
  if (status === 401 && !MISSING_PERMISSION.test(text)) {
    return new ElevenLabsError('invalid_key', message, details);
  }
  if (status === 401 || status === 403) {
    return new ElevenLabsError('permission', message, details);
  }
  if (status === 404 && (code === 'voice_not_found' || code === undefined)) {
    return new ElevenLabsError('voice_not_found', message, details);
  }
  if (status === 429) {
    return new ElevenLabsError('rate_limited', message, details);
  }
  if (status >= 500 || status < 400) {
    return new ElevenLabsError('server', message, details);
  }
  return new ElevenLabsError('invalid_request', message, details);
}

/**
 * The voice fields the integration uses, from a voice object of the API.
 * @param {any} voice - `{voice_id, name, category, …}`.
 * @returns {{id: string, name: string, category: string}} The voice.
 */
function toVoice(voice) {
  return {
    id: String(voice?.voice_id ?? ''),
    name: String(voice?.name ?? ''),
    category: typeof voice?.category === 'string' ? voice.category : '',
  };
}

export class ElevenLabsClient {
  #apiKey;

  /**
   * @param {object} options
   * @param {string} options.apiKey - ElevenLabs API key.
   * @param {typeof fetch} [options.fetchImpl] - Injectable for tests.
   * @param {number} [options.timeoutMs] - Deadline of a lookup (headers AND body).
   * @param {number} [options.synthesisTimeoutMs] - Deadline of a synthesis.
   * @param {string} [options.baseUrl] - API root, for tests.
   */
  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    synthesisTimeoutMs = SYNTHESIS_TIMEOUT_MS,
    baseUrl = API_BASE_URL,
  }) {
    this.#apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.synthesisTimeoutMs = synthesisTimeoutMs;
    this.baseUrl = baseUrl;
  }

  /**
   * Send one request and return the successful response with its body read.
   * @param {string} method - HTTP method.
   * @param {string} path - Path under the API root, query string included.
   * @param {object} [options]
   * @param {object} [options.json] - JSON body.
   * @param {string} [options.accept] - Expected content type.
   * @param {boolean} [options.binary] - Read the body as bytes instead of JSON.
   * @param {number} [options.timeoutMs] - Deadline of this request.
   * @returns {Promise<{body: any, headers: Headers}>} The parsed JSON, or a Buffer when `binary`.
   */
  async request(
    method,
    path,
    { json, accept = 'application/json', binary = false, timeoutMs = this.timeoutMs } = {},
  ) {
    // The label never carries the query string: a search holds what the user typed.
    const label = `${method} ${path.split('?')[0]}`;
    const redact = (text) => (this.#apiKey ? text.replaceAll(this.#apiKey, '***') : text);
    const headers = { Accept: accept, 'xi-api-key': this.#apiKey };
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    let bytes;
    try {
      // The same signal also aborts the body read below.
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(timeoutMs),
      });
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      throw networkError(err, label);
    }

    if (!response.ok || !binary) {
      let parsed = null;
      try {
        parsed = JSON.parse(bytes.toString('utf8'));
      } catch {
        // Handled below: an error page is classified by its status alone.
      }
      if (!response.ok) {
        throw apiError(label, response.status, parsed, redact);
      }
      if (parsed === null || typeof parsed !== 'object') {
        // A 2xx that is not JSON: a captive portal or a proxy page, not ElevenLabs.
        throw new ElevenLabsError('invalid_response', `${label}: unexpected answer`, {
          status: response.status,
        });
      }
      return { body: parsed, headers: response.headers };
    }
    return { body: bytes, headers: response.headers };
  }

  /**
   * Credits of the subscription. Needs the "User: read" permission on a
   * restricted key.
   * @returns {Promise<{used: number, limit: number, resetAt: number|null}>} Credits used and included this period, reset time in ms.
   * @example
   * const { used, limit } = await client.getSubscription();
   */
  async getSubscription() {
    const { body } = await this.request('GET', '/v1/user/subscription');
    const reset = body.next_character_count_reset_unix;
    return {
      used: body.character_count,
      limit: body.character_limit,
      resetAt: Number.isFinite(reset) ? reset * 1000 : null,
    };
  }

  /**
   * One voice, by id.
   * @param {string} voiceId - The voice id.
   * @returns {Promise<{id: string, name: string, category: string}>} The voice.
   * @throws {ElevenLabsError} `voice_not_found` when the account has no such voice.
   */
  async getVoice(voiceId) {
    const { body } = await this.request('GET', `/v1/voices/${encodeURIComponent(voiceId)}`);
    return toVoice(body);
  }

  /**
   * One page of the voices of the account (its own voices, the voices saved
   * from the library and the default voices).
   * @param {object} [options]
   * @param {string} [options.search] - Matched against names, descriptions and labels.
   * @param {string} [options.nextPageToken] - Token of the page to read.
   * @returns {Promise<{voices: {id: string, name: string, category: string}[], nextPageToken: string|null}>} The page.
   */
  async searchVoices({ search, nextPageToken } = {}) {
    const query = new URLSearchParams({
      page_size: String(VOICES_PAGE_SIZE),
      include_total_count: 'false',
    });
    if (search) {
      query.set('search', search);
    }
    if (nextPageToken) {
      query.set('next_page_token', nextPageToken);
    }
    const { body } = await this.request('GET', `/v2/voices?${query}`);
    const voices = Array.isArray(body.voices) ? body.voices.map(toVoice) : [];
    const token = body.has_more && typeof body.next_page_token === 'string';
    return { voices, nextPageToken: token ? body.next_page_token : null };
  }

  /**
   * Every voice of the account, up to `max`.
   * @param {object} [options]
   * @param {number} [options.max] - Stop after this many voices.
   * @returns {Promise<{voices: {id: string, name: string, category: string}[], truncated: boolean}>} The voices, and whether some were left out.
   * @example
   * const { voices } = await client.listVoices();
   */
  async listVoices({ max = 300 } = {}) {
    const voices = [];
    let nextPageToken;
    do {
      const page = await this.searchVoices({ nextPageToken });
      voices.push(...page.voices);
      nextPageToken = page.nextPageToken;
    } while (nextPageToken && voices.length < max);
    return {
      voices: voices.slice(0, max),
      truncated: Boolean(nextPageToken) || voices.length > max,
    };
  }

  /**
   * Synthesize a text into an MP3 clip.
   * @param {object} request
   * @param {string} request.voiceId - The voice id.
   * @param {string} request.text - The text to say.
   * @param {string} request.modelId - The model id.
   * @param {string} [request.languageCode] - ISO 639-1 code, for the models that take one.
   * @param {{speed: number, stability: number}} request.voiceSettings - Voice settings.
   * @returns {Promise<Buffer>} The MP3 bytes.
   * @example
   * const mp3 = await client.synthesize({ voiceId, text: 'Hello', modelId: 'eleven_flash_v2_5', voiceSettings: { speed: 1, stability: 0.5 } });
   */
  async synthesize({ voiceId, text, modelId, languageCode, voiceSettings }) {
    const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
    const json = { text, model_id: modelId, voice_settings: voiceSettings };
    if (languageCode) {
      json.language_code = languageCode;
    }
    const { body, headers } = await this.request('POST', path, {
      json,
      accept: 'audio/mpeg',
      binary: true,
      timeoutMs: this.synthesisTimeoutMs,
    });
    const label = 'POST /v1/text-to-speech';
    const contentType = headers.get('content-type') ?? '';
    if (!contentType.startsWith('audio/') || body.length === 0) {
      throw new ElevenLabsError('invalid_response', `${label}: no audio in the answer`);
    }
    if (body.length > MAX_AUDIO_BYTES) {
      throw new ElevenLabsError(
        'too_large',
        `${label}: the clip is ${body.length} bytes, over the ${MAX_AUDIO_BYTES} bytes Gladys accepts`,
      );
    }
    return body;
  }
}

/**
 * Actionable message, for the administrator, of an ElevenLabs failure.
 * @param {unknown} err - Usually an ElevenLabsError.
 * @returns {{en: string, fr: string}} The message.
 * @example
 * describeError(new ElevenLabsError('invalid_key', '...')).en;
 */
export function describeError(err) {
  const code = err?.code ? ` (${err.code})` : '';
  switch (err?.kind) {
    case 'invalid_key':
      return {
        en: 'ElevenLabs refused the API key: check it in your ElevenLabs settings, then save it again here.',
        fr: "ElevenLabs a refusé la clé d'API : vérifiez-la dans vos paramètres ElevenLabs, puis enregistrez-la à nouveau ici.",
      };
    case 'permission':
      return {
        en: `The API key is not allowed to do this${code}: give it the "Text to Speech" and "Voices: read" permissions, or check that your plan includes the chosen model.`,
        fr: `La clé d'API n'a pas le droit de faire cela${code} : donnez-lui les permissions « Text to Speech » et « Voices : read », ou vérifiez que votre abonnement inclut le modèle choisi.`,
      };
    case 'credits':
      return {
        en: 'Your ElevenLabs credits are used up: wait for the next renewal or upgrade your plan.',
        fr: "Vos crédits ElevenLabs sont épuisés : attendez le prochain renouvellement ou changez d'abonnement.",
      };
    case 'voice_not_found':
      return {
        en: 'This voice is not in your ElevenLabs account: use the "List my voices" button, then copy a name or an id into the Voice field.',
        fr: "Cette voix n'est pas dans votre compte ElevenLabs : utilisez le bouton « Lister mes voix », puis copiez un nom ou un identifiant dans le champ Voix.",
      };
    case 'rate_limited':
      return {
        en: `ElevenLabs is busy or too many requests run at once${code}: try again in a moment.`,
        fr: `ElevenLabs est saturé ou trop de demandes sont en cours${code} : réessayez dans un instant.`,
      };
    case 'timeout':
    case 'unreachable':
      return {
        en: 'ElevenLabs cannot be reached: check the Internet connection of Gladys.',
        fr: 'ElevenLabs est injoignable : vérifiez la connexion Internet de Gladys.',
      };
    case 'too_large':
      return {
        en: 'The audio clip is too large for Gladys: shorten the text.',
        fr: 'Le clip audio est trop gros pour Gladys : raccourcissez le texte.',
      };
    case 'invalid_request':
      return {
        en: `ElevenLabs refused the request${code}: check the voice and the model in the configuration.`,
        fr: `ElevenLabs a refusé la demande${code} : vérifiez la voix et le modèle dans la configuration.`,
      };
    default:
      return {
        en: 'ElevenLabs is not working right now: try again later.',
        fr: 'ElevenLabs ne fonctionne pas pour le moment : réessayez plus tard.',
      };
  }
}
