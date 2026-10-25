// -----------------------------------------------------------------------------
// The last synthesized clips, in memory.
//
// Home announcements repeat ("The front door is open", "Dinner is ready"), and
// a scene announcing on several speakers asks for the same text once per
// speaker. Every synthesis costs ElevenLabs credits: a clip already made with
// the same voice and settings is served again instead. Least recently used
// clips are evicted first, within a byte budget that fits the 256 MB of the
// container. Nothing goes to disk (the root filesystem is read-only).
// -----------------------------------------------------------------------------

export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 100;

export class ClipCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxBytes] - Total size of the clips kept.
   * @param {number} [options.maxEntries] - Number of clips kept.
   */
  constructor({ maxBytes = DEFAULT_MAX_BYTES, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    // Insertion order is recency order: the first key is the least recently used.
    this.clips = new Map();
    this.bytes = 0;
  }

  /**
   * The clip of a key, marked as just used.
   * @param {string} key - See ClipCache.key().
   * @returns {Buffer|undefined} The clip, undefined when absent.
   */
  get(key) {
    const clip = this.clips.get(key);
    if (clip !== undefined) {
      this.clips.delete(key);
      this.clips.set(key, clip);
    }
    return clip;
  }

  /**
   * Keep a clip, evicting the least recently used ones beyond the budget. A
   * clip larger than the whole budget is not kept.
   * @param {string} key - See ClipCache.key().
   * @param {Buffer} clip - The audio.
   * @returns {void}
   */
  set(key, clip) {
    this.delete(key);
    if (clip.length > this.maxBytes) {
      return;
    }
    this.clips.set(key, clip);
    this.bytes += clip.length;
    while (this.bytes > this.maxBytes || this.clips.size > this.maxEntries) {
      this.delete(this.clips.keys().next().value);
    }
  }

  /**
   * Forget one clip.
   * @param {string} key - See ClipCache.key().
   * @returns {void}
   */
  delete(key) {
    const clip = this.clips.get(key);
    if (clip !== undefined) {
      this.clips.delete(key);
      this.bytes -= clip.length;
    }
  }

  /**
   * Forget every clip (a new configuration changes the voice or the settings).
   * @returns {void}
   */
  clear() {
    this.clips.clear();
    this.bytes = 0;
  }

  /**
   * The key of a synthesis: everything that changes the audio.
   * @param {object} request - The arguments of ElevenLabsClient.synthesize().
   * @returns {string} The key.
   * @example
   * ClipCache.key({ voiceId, text, modelId, languageCode, voiceSettings });
   */
  static key({ voiceId, text, modelId, languageCode, voiceSettings }) {
    return JSON.stringify([
      voiceId,
      modelId,
      languageCode ?? null,
      voiceSettings.speed,
      voiceSettings.stability,
      text,
    ]);
  }
}
