// -----------------------------------------------------------------------------
// ElevenLabsIntegration: everything the SDK handlers of src/app.js call.
//
// - applyConfig(): takes the configuration, finds the chosen voice in the
//   ElevenLabs account (by id, or by name), reads the credits left, and
//   reports the result as the connection status shown on the configuration
//   screen. Never throws.
// - handleSynthesize(): turns a text Gladys wants spoken into an MP3 clip.
//   Throwing acks the command as failed: the scene action fails visibly, the
//   voice assistant answers in text only.
// - listVoices(): the "List my voices" button, so the administrator can pick a
//   voice (the configuration form only offers fixed choices).
//
// Every synthesis costs ElevenLabs credits: a clip already made with the same
// voice and settings is served from memory, and identical requests running at
// the same time (one announcement on several speakers) share one synthesis.
// -----------------------------------------------------------------------------

import { logger as defaultLogger } from '@gladysassistant/integration-sdk';
import { ClipCache } from './clip-cache.js';
import { ElevenLabsClient, ElevenLabsError, describeError } from './elevenlabs/client.js';
import { isVoiceId, languageCode, normalizeConfig } from './config.js';

export const MESSAGES = {
  notConfigured: {
    en: 'Enter your ElevenLabs API key in the integration settings.',
    fr: "Saisissez votre clé d'API ElevenLabs dans les paramètres de l'intégration.",
  },
  voiceNeedsId: {
    en: 'The API key cannot read your voices, so the voice cannot be found by its name: enter its id in the Voice field, or give the key the "Voices: read" permission.',
    fr: "La clé d'API ne peut pas lire vos voix, la voix ne peut donc pas être trouvée par son nom : saisissez son identifiant dans le champ Voix, ou donnez à la clé la permission « Voices : read ».",
  },
};

// Failures only a new configuration can fix: nothing is sent until then.
const BLOCKING_ERRORS = ['invalid_key', 'voice_not_found', 'voice_needs_id'];
// Failures about the whole service, shown as the connection status. The
// others (a request ElevenLabs refused, too many requests at once) concern
// one synthesis only.
const CHANNEL_ERRORS = [
  ...BLOCKING_ERRORS,
  'permission',
  'credits',
  'unreachable',
  'timeout',
  'server',
  'invalid_response',
];
// The "List my voices" answer stays readable below that.
export const MAX_LISTED_VOICES = 300;

/**
 * Actionable message of a failure, for the administrator.
 * @param {unknown} err - Usually an ElevenLabsError.
 * @returns {{en: string, fr: string}} The message.
 */
function describe(err) {
  return err?.kind === 'voice_needs_id' ? MESSAGES.voiceNeedsId : describeError(err);
}

/**
 * The error a failed command acks: the actionable text and the technical
 * detail, since only the message reaches Gladys.
 * @param {Error} err - The failure.
 * @returns {Error} The error to throw.
 */
function failure(err) {
  return new Error(`${describe(err).en} [${err.message}]`, { cause: err });
}

/**
 * Whether the name of a voice is the one typed in the Voice field. Default
 * voices are named like "George - Warm, Captivating Storyteller": the part
 * before " - " is enough.
 * @param {string} voiceName - Name of a voice of the account.
 * @param {string} wanted - The trimmed Voice field.
 * @returns {boolean} True when it designates that voice.
 * @example
 * matchesVoiceName('George - Warm, Captivating Storyteller', 'george'); // true
 */
export function matchesVoiceName(voiceName, wanted) {
  const name = voiceName.trim().toLowerCase();
  const target = wanted.toLowerCase();
  return name === target || name.split(' - ')[0].trim() === target;
}

const formatNumber = (number, locale) => number.toLocaleString(locale);
// Local timezone (TZ is injected in the container), like every date shown.
const formatDate = (time, locale) =>
  new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'long' });

/**
 * Connection status message: the voice in use and the credits left.
 * @param {{name: string}} voice - The voice in use.
 * @param {{used: unknown, limit: unknown, resetAt: number|null}|null} credits - Answer of getSubscription(), null when unknown.
 * @returns {{en: string, fr: string}} The message.
 */
export function connectedMessage(voice, credits) {
  const en = `Connected to ElevenLabs, voice "${voice.name}".`;
  const fr = `Connecté à ElevenLabs, voix « ${voice.name} ».`;
  if (!Number.isFinite(credits?.used) || !Number.isFinite(credits?.limit)) {
    return { en, fr };
  }
  const left = Math.max(credits.limit - credits.used, 0);
  const renewal = Number.isFinite(credits.resetAt)
    ? {
        en: `, renewed on ${formatDate(credits.resetAt, 'en-GB')}`,
        fr: `, renouvelés le ${formatDate(credits.resetAt, 'fr-FR')}`,
      }
    : { en: '', fr: '' };
  return {
    en: `${en} ${formatNumber(left, 'en-GB')} of ${formatNumber(credits.limit, 'en-GB')} credits left${renewal.en}.`,
    fr: `${fr} ${formatNumber(left, 'fr-FR')} crédits restants sur ${formatNumber(credits.limit, 'fr-FR')}${renewal.fr}.`,
  };
}

/**
 * The answer of the "List my voices" button.
 * @param {{voices: {id: string, name: string, category: string}[], truncated: boolean}} result - Answer of listVoices().
 * @param {string|undefined} currentId - Id of the voice in use, marked with ✓.
 * @returns {{en: string, fr: string}} The message.
 */
export function voicesMessage({ voices, truncated }, currentId) {
  if (voices.length === 0) {
    return {
      en: 'There is no voice in your ElevenLabs account: add one from the Voice Library.',
      fr: "Il n'y a aucune voix dans votre compte ElevenLabs : ajoutez-en une depuis la Voice Library.",
    };
  }
  const lines = [...voices]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((voice) => {
      const mark = voice.id === currentId ? '✓' : '•';
      const category = voice.category ? ` (${voice.category})` : '';
      return `${mark} ${voice.name} — ${voice.id}${category}`;
    })
    .join('\n');
  const count = voices.length;
  const more = truncated
    ? {
        en: ` Only the first ${count} are listed.`,
        fr: ` Seules les ${count} premières sont affichées.`,
      }
    : { en: '', fr: '' };
  return {
    en: `${count} voice(s) in your ElevenLabs account.${more.en} Copy a name or an id into the Voice field, then save.\n\n${lines}`,
    fr: `${count} voix dans votre compte ElevenLabs.${more.fr} Copiez un nom ou un identifiant dans le champ Voix, puis enregistrez.\n\n${lines}`,
  };
}

export class ElevenLabsIntegration {
  /**
   * @param {object} gladys - The SDK instance (GladysIntegration).
   * @param {object} [deps]
   * @param {(options: {apiKey: string}) => ElevenLabsClient} [deps.createClient] - Injectable for tests.
   * @param {{info: Function, warn: Function, debug: Function}} [deps.logger] - Injectable for tests.
   * @param {ClipCache} [deps.cache] - Injectable for tests.
   */
  constructor(
    gladys,
    {
      createClient = (options) => new ElevenLabsClient(options),
      logger = defaultLogger,
      cache = new ClipCache(),
    } = {},
  ) {
    this.gladys = gladys;
    this.createClient = createClient;
    this.logger = logger;
    this.cache = cache;
    this.loaded = false;
    // Pending read of the configuration by a command arriving before the SDK
    // resynchronized it.
    this.loading = null;
    this.settings = normalizeConfig({});
    this.client = null;
    // {en, fr} reason why nothing can be synthesized, null when it can.
    this.blocker = MESSAGES.notConfigured;
    // Bumped by every configuration: the outcome of a request made with an
    // older configuration must not change the state of the new one.
    this.generation = 0;
    // The voice found in the account, and the lookup running meanwhile.
    this.voice = null;
    this.voiceLookup = null;
    // Status message once connected (voice and credits).
    this.connectedStatus = null;
    // Synthesis key -> pending synthesis, shared by identical requests.
    this.inFlight = new Map();
    this.status = null;
  }

  /**
   * Take a configuration into account: synchronously (so a request arriving
   * meanwhile already uses it), then check it with ElevenLabs.
   * @param {Record<string, unknown>} rawConfig - Configuration from the SDK.
   * @returns {Promise<void>} Never rejects.
   * @example
   * await integration.applyConfig(gladys.config);
   */
  async applyConfig(rawConfig) {
    const settings = normalizeConfig(rawConfig);
    this.loaded = true;
    this.generation += 1;
    const generation = this.generation;
    this.settings = settings;
    this.client = settings.api_key === '' ? null : this.createClient({ apiKey: settings.api_key });
    this.blocker = this.client ? null : MESSAGES.notConfigured;
    this.voice = null;
    this.voiceLookup = null;
    this.connectedStatus = null;
    this.cache.clear();
    this.inFlight.clear();
    if (this.blocker) {
      this.logger.warn(`ElevenLabs cannot be used: ${this.blocker.en}`);
      await this.reportConnection(false, this.blocker);
      return;
    }

    let voice;
    try {
      voice = await this.ensureVoice();
    } catch (err) {
      // Already reported by ensureVoice.
      this.logger.warn(`ElevenLabs check failed: ${err.message}`);
      return;
    }
    let credits = null;
    try {
      credits = await this.client.getSubscription();
    } catch (err) {
      // A restricted key may lack the "User: read" permission: the status
      // then shows the voice without the credits.
      this.logger.debug(`ElevenLabs credits not read: ${err.message}`);
    }
    if (generation !== this.generation) {
      return;
    }
    this.connectedStatus = connectedMessage(voice, credits);
    this.logger.info(
      `ElevenLabs ready: voice "${voice.name}" (${voice.id}), model ${settings.model}`,
    );
    await this.reportConnection(true, this.connectedStatus);
  }

  /**
   * Find the voice of the configuration in the account: by id, or by name.
   * @param {ElevenLabsClient} client - Client of the configuration.
   * @param {string} value - The Voice field.
   * @returns {Promise<{id: string, name: string, category: string}>} The voice.
   * @throws {ElevenLabsError} `voice_not_found` when the account has no such voice.
   */
  async resolveVoice(client, value) {
    if (isVoiceId(value)) {
      try {
        return await client.getVoice(value);
      } catch (err) {
        // A key without the "Voices: read" permission can still speak with an id.
        if (err.kind === 'permission') {
          return { id: value, name: value, category: '' };
        }
        throw err;
      }
    }
    let voices;
    try {
      ({ voices } = await client.searchVoices({ search: value }));
    } catch (err) {
      if (err.kind === 'permission') {
        throw new ElevenLabsError('voice_needs_id', err.message, { status: err.status });
      }
      throw err;
    }
    const target = value.toLowerCase();
    const voice =
      voices.find((candidate) => candidate.name.trim().toLowerCase() === target) ??
      voices.find((candidate) => matchesVoiceName(candidate.name, value));
    if (!voice) {
      throw new ElevenLabsError('voice_not_found', `no voice named "${value}" in the account`);
    }
    return voice;
  }

  /**
   * The voice of the configuration, looked up once (concurrent callers share
   * the lookup). A failure is reported as the connection status.
   * @returns {Promise<{id: string, name: string, category: string}>} The voice.
   */
  async ensureVoice() {
    if (this.voice) {
      return this.voice;
    }
    if (!this.voiceLookup) {
      const generation = this.generation;
      this.voiceLookup = this.resolveVoice(this.client, this.settings.voice).then(
        (voice) => {
          if (generation === this.generation) {
            this.voice = voice;
            this.voiceLookup = null;
          }
          return voice;
        },
        async (err) => {
          if (generation === this.generation) {
            this.voiceLookup = null;
            await this.handleChannelError(err);
          }
          throw err;
        },
      );
    }
    return this.voiceLookup;
  }

  /**
   * Read the configuration when a command arrives before the SDK
   * resynchronized it (Gladys relays right after the WebSocket authenticates).
   * @returns {Promise<void>}
   */
  async load() {
    if (this.loaded) {
      return;
    }
    this.loading ??= this.gladys.getConfig().then(
      (config) => this.applyConfig(config),
      (err) => {
        this.loading = null;
        throw err;
      },
    );
    await this.loading;
  }

  /**
   * Synthesize a text Gladys wants spoken.
   * @param {string} text - The text (≤ 2,000 characters, capped by Gladys).
   * @param {string|null} language - Language of the requesting user, null for a scene without one.
   * @returns {Promise<string>} The clip, as `audio/mpeg;base64,…`.
   * @throws {Error} When no clip can be made.
   * @example
   * await integration.handleSynthesize('The front door is open', 'en');
   */
  async handleSynthesize(text, language) {
    try {
      return await this.synthesize(text, language);
    } catch (err) {
      // The failed ack only reaches the Gladys server log: say it here too,
      // in the integration logs the admin can open from Gladys.
      this.logger.warn(`Speech not synthesized: ${err.message}`);
      throw err;
    }
  }

  /**
   * The body of handleSynthesize.
   * @param {string} text - The text.
   * @param {string|null} language - Language of the requesting user.
   * @returns {Promise<string>} The clip, as `audio/mpeg;base64,…`.
   */
  async synthesize(text, language) {
    await this.load();
    if (this.blocker) {
      throw new Error(this.blocker.en);
    }
    const spoken = typeof text === 'string' ? text.trim() : '';
    if (spoken === '') {
      throw new Error('Empty text: nothing to say');
    }
    const generation = this.generation;
    const { client, settings } = this;
    let voice;
    try {
      voice = await this.ensureVoice();
    } catch (err) {
      throw failure(err);
    }

    const request = {
      voiceId: voice.id,
      text: spoken,
      modelId: settings.model,
      languageCode: languageCode(language, settings.model),
      voiceSettings: { speed: settings.speed, stability: settings.stability },
    };
    const key = ClipCache.key(request);
    let clip = this.cache.get(key);
    if (clip) {
      this.logger.debug(`Clip served from memory (${spoken.length} characters, no credit used)`);
      return `audio/mpeg;base64,${clip.toString('base64')}`;
    }
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = client.synthesize(request).finally(() => {
        if (this.inFlight.get(key) === pending) {
          this.inFlight.delete(key);
        }
      });
      this.inFlight.set(key, pending);
    }

    try {
      clip = await pending;
    } catch (err) {
      if (generation === this.generation && CHANNEL_ERRORS.includes(err.kind)) {
        await this.handleChannelError(err);
      }
      throw failure(err);
    }
    if (generation === this.generation) {
      this.cache.set(key, clip);
      if (this.status?.connected !== true) {
        await this.reportConnection(true, this.connectedStatus ?? connectedMessage(voice, null));
      }
    }
    this.logger.debug(`Clip synthesized: ${spoken.length} characters, ${clip.length} bytes`);
    return `audio/mpeg;base64,${clip.toString('base64')}`;
  }

  /**
   * The "List my voices" button: every voice of the account, the one in use
   * marked.
   * @returns {Promise<{en: string, fr: string}>} The message shown under the button.
   * @throws {Error} When the voices cannot be read.
   */
  async listVoices() {
    await this.load();
    if (!this.client) {
      throw new Error(MESSAGES.notConfigured.en);
    }
    let result;
    try {
      result = await this.client.listVoices({ max: MAX_LISTED_VOICES });
    } catch (err) {
      throw failure(err);
    }
    return voicesMessage(result, this.voice?.id);
  }

  /**
   * React to a failure that concerns the whole service (key, voice, credits,
   * ElevenLabs itself): show it as the connection status, and stop
   * requesting with a key or a voice ElevenLabs refused.
   * @param {unknown} err - The error.
   * @returns {Promise<void>}
   */
  async handleChannelError(err) {
    const description = describe(err);
    if (BLOCKING_ERRORS.includes(err?.kind)) {
      this.blocker = description;
      this.voice = null;
    }
    await this.reportConnection(false, description);
  }

  /**
   * Publish the connection status, only when it changes (it is pushed to
   * every open Gladys page). A failure is logged, never thrown: a synthesis
   * must not fail because the status could not be shown.
   * @param {boolean} connected - Whether ElevenLabs can be used.
   * @param {{en: string, fr: string}} [message] - Why, shown to the admin.
   * @returns {Promise<void>}
   */
  async reportConnection(connected, message) {
    const status = { connected, message: message ?? null };
    if (
      this.status?.connected === status.connected &&
      this.status?.message?.en === status.message?.en
    ) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.status = status;
    } catch (err) {
      this.logger.warn(`Unable to publish the connection status: ${err.message}`);
    }
  }
}
