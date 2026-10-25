// -----------------------------------------------------------------------------
// Entry point of the ElevenLabs external integration for Gladys Assistant.
//
// A text-to-speech provider (manifest `type: "tts"`): once an administrator
// selects it as the voice of Gladys, the scene announcements on the speakers
// are synthesized by ElevenLabs.
//
// This file only WIRES the SDK to ElevenLabsIntegration (src/integration.js)
// through registerHandlers (src/app.js); it holds no logic.
//
// Environment variables provided by the Gladys supervisor:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// `new GladysIntegration()` reads them automatically.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';
import { ElevenLabsIntegration } from './src/integration.js';
import { exitOnUnhandledRejection } from './src/lifecycle.js';

// Safety net: a rejection nobody handles is a bug. Log it where the user can
// see it, then exit so the Gladys supervisor restarts from a clean state.
exitOnUnhandledRejection({ logger });

const gladys = new GladysIntegration();
registerHandlers(gladys, new ElevenLabsIntegration(gladys));

// --- Startup -----------------------------------------------------------------
logger.info('Starting the ElevenLabs integration...');
// connect() only rejects when Gladys refuses the token on the first attempt;
// the SDK keeps reconnecting afterwards (the refusal can be transient, e.g.
// Gladys still booting), so stay alive instead of exiting.
gladys.connect().catch((err) => {
  logger.error('Initial connection failed, the SDK keeps retrying', err);
});
