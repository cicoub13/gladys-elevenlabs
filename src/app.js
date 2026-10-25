// -----------------------------------------------------------------------------
// Wiring of the integration on a Gladys client.
//
// Kept apart from `index.js` so the tests can run it against the SDK's fake
// Gladys (`createFakeGladys` from `@gladysassistant/integration-sdk/testing`),
// the way ../gladys-callmebot does.
// -----------------------------------------------------------------------------

import { logger as defaultLogger } from '@gladysassistant/integration-sdk';

/**
 * Register every handler on `gladys`, before connect().
 * @param {object} gladys - The SDK instance (GladysIntegration).
 * @param {import('./integration.js').ElevenLabsIntegration} integration - What the handlers call.
 * @param {object} [deps]
 * @param {{info: Function}} [deps.logger] - Injectable for tests.
 * @returns {void}
 * @example
 * registerHandlers(gladys, new ElevenLabsIntegration(gladys));
 */
export function registerHandlers(gladys, integration, { logger = defaultLogger } = {}) {
  // --- Speech --------------------------------------------------------------
  // The integration is the voice an administrator selected on the Artificial
  // Intelligence page. `language` is the requesting user's, null for a scene
  // announcement without one. Gladys waits 30 s for the clip.
  gladys.onTtsSynthesize((text, language) => integration.handleSynthesize(text, language));

  // --- "List my voices" button of the configuration screen ------------------
  gladys.onAction('list_voices', () => integration.listVoices());

  // --- Configuration screen --------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    await integration.applyConfig(newConfig);
  });

  // --- Connection lifecycle --------------------------------------------------
  // The SDK emits `connected` once it has resynchronized the configuration from
  // the host API (retrying until it can), so `gladys.config` is fresh here.
  // applyConfig never rejects: ElevenLabs errors become the connection status.
  gladys.on('connected', () => integration.applyConfig(gladys.config));

  // --- Graceful shutdown -----------------------------------------------------
  gladys.handleShutdown();
}
