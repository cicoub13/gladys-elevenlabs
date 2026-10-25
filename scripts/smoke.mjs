// -----------------------------------------------------------------------------
// Manual end-to-end check against the REAL ElevenLabs API, without Gladys.
//
// Drives ElevenLabsIntegration exactly like the SDK does (applyConfig, the
// "List my voices" button, then handleSynthesize), with a stand-in for Gladys
// that prints the connection status. Synthesizes one short sentence (a few
// dozen credits) and saves it as an MP3 in the temporary directory, to listen.
//
// Usage: put your settings in .env (ignored by git), then `npm run smoke`.
//   ELEVENLABS_API_KEY=...   API key
//   ELEVENLABS_VOICE=...     optional, voice name or id (George by default)
//   ELEVENLABS_MODEL=...     optional, model id (eleven_flash_v2_5 by default)
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ElevenLabsIntegration } from '../src/integration.js';

const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE, ELEVENLABS_MODEL } = process.env;
if (!ELEVENLABS_API_KEY) {
  console.error('Set ELEVENLABS_API_KEY in .env, then run `npm run smoke`.');
  process.exit(1);
}

const logger = {
  info: (message) => console.log(`  [info] ${message}`),
  warn: (message) => console.log(`  [warn] ${message}`),
  debug: (message) => console.log(`  [debug] ${message}`),
};
const config = { api_key: ELEVENLABS_API_KEY, voice: ELEVENLABS_VOICE, model: ELEVENLABS_MODEL };
const gladys = {
  async getConfig() {
    return config;
  },
  async setConnectionStatus(connected, message) {
    console.log(`  [status] connected=${connected} ${message?.fr ?? ''}`);
  },
};
const integration = new ElevenLabsIntegration(gladys, { logger });
const output = join(tmpdir(), 'gladys-elevenlabs-smoke.mp3');

const steps = [
  ['Configuration check', () => integration.applyConfig(config)],
  [
    'List my voices',
    async () =>
      console.log((await integration.listVoices()).fr.split('\n').slice(0, 12).join('\n')),
  ],
  [
    'Synthesis',
    async () => {
      const audio = await integration.handleSynthesize(
        `Test de l'intégration Gladys ElevenLabs, il est ${new Date().toLocaleTimeString('fr-FR')}.`,
        'fr',
      );
      writeFileSync(output, Buffer.from(audio.split(';base64,')[1], 'base64'));
      console.log(`  saved to ${output}`);
    },
  ],
];

let failed = false;
for (const [label, run] of steps) {
  console.log(`${label}...`);
  try {
    await run();
    console.log('  ok');
  } catch (err) {
    failed = true;
    console.log(`  FAILED: ${err.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
