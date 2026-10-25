// -----------------------------------------------------------------------------
// The integration configuration (`config_schema`, filled by the administrator):
// the API key, the voice, the model and two voice settings.
//
// This module trims the values and falls back to the defaults of the manifest
// when a value is missing or out of range, so the code never sends ElevenLabs
// a setting it would refuse. Pure functions, no I/O.
// -----------------------------------------------------------------------------

// The models offered in the configuration, and whether each one takes the
// `language_code` of the request (eleven_multilingual_v2 does not: it detects
// the language from the text).
export const MODELS = {
  eleven_flash_v2_5: { languageCode: true },
  eleven_multilingual_v2: { languageCode: false },
  eleven_v3: { languageCode: true },
};

export const DEFAULTS = {
  voice: 'George',
  model: 'eleven_flash_v2_5',
  speed: 1,
  stability: 0.5,
};

// Ranges ElevenLabs accepts for the voice settings.
export const SPEED_RANGE = { min: 0.7, max: 1.2 };
export const STABILITY_RANGE = { min: 0, max: 1 };

// ElevenLabs voice ids: 20 letters and digits.
const VOICE_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A number within `range`, or `fallback` when it is missing or outside.
 * The form may hand back a number or its text.
 * @param {unknown} value - The raw value.
 * @param {{min: number, max: number}} range - Accepted bounds, inclusive.
 * @param {number} fallback - Value used otherwise.
 * @returns {number} The number to use.
 */
function inRange(value, range, fallback) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return fallback;
  }
  return number >= range.min && number <= range.max ? number : fallback;
}

/**
 * Normalize the integration configuration.
 * @param {Record<string, unknown>} [raw] - Configuration returned by the SDK.
 * @returns {{api_key: string, voice: string, model: string, speed: number, stability: number}} The configuration to use.
 * @example
 * normalizeConfig({ api_key: ' sk_123 ', voice: 'Sarah' });
 */
export function normalizeConfig(raw) {
  // `= {}` would not cover an explicit null, which getConfig() can return.
  const source = raw ?? {};
  const model = trimmed(source.model);
  return {
    api_key: trimmed(source.api_key),
    voice: trimmed(source.voice) || DEFAULTS.voice,
    model: Object.hasOwn(MODELS, model) ? model : DEFAULTS.model,
    speed: inRange(source.speed, SPEED_RANGE, DEFAULTS.speed),
    stability: inRange(source.stability, STABILITY_RANGE, DEFAULTS.stability),
  };
}

/**
 * Whether the voice field holds a voice id rather than a voice name.
 * @param {string} value - The trimmed voice field.
 * @returns {boolean} True for 20 letters and digits.
 * @example
 * isVoiceId('JBFqnCBsd6RMkjVDRZzb'); // true
 */
export function isVoiceId(value) {
  return VOICE_ID_PATTERN.test(value);
}

/**
 * The `language_code` to send for a Gladys language, or undefined when the
 * model does not take one or the language is unknown (the voice then speaks
 * the language of the text).
 * @param {string|null|undefined} language - Language of the requesting user ('fr', 'en-US'…), null for a scene without one.
 * @param {string} model - A key of MODELS.
 * @returns {string|undefined} An ISO 639-1 code such as 'fr'.
 * @example
 * languageCode('fr-FR', 'eleven_flash_v2_5'); // 'fr'
 */
export function languageCode(language, model) {
  if (!MODELS[model]?.languageCode || typeof language !== 'string') {
    return undefined;
  }
  const match = /^([a-z]{2})(?:[-_][a-z0-9]+)?$/i.exec(language.trim());
  return match ? match[1].toLowerCase() : undefined;
}
