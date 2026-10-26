# ElevenLabs — Gladys Assistant external integration

Give [Gladys Assistant](https://gladysassistant.com) a natural voice with
[ElevenLabs](https://elevenlabs.io): the scene announcements are spoken on
your speakers with the ElevenLabs voice of your choice. Built as an external
integration running in its own container, on the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

> **Requires Gladys ≥ 5.3.0**, the first release with text-to-speech provider
> integrations. `gladys_version` in the manifest declares that floor.

## Features

- A **text-to-speech provider** (`type: tts`): once selected in the **Voice
  (text-to-speech provider)** card of the Artificial Intelligence page, the
  **Talk on a speaker** scene action speaks with ElevenLabs on Sonos, Google
  Cast or AirPlay speakers, without a Gladys Plus subscription.
- **Any voice of the account**, by name or by id. The **List my voices**
  button of the configuration screen shows them all, the one in use marked.
- **Model** (Flash v2.5, Multilingual v2, v3, v4, v4 Turbo), **speed** and **stability**
  settings. The language of the request is passed on to the models that take
  it.
- **Fewer credits**: a sentence already spoken with the same voice and settings
  is served from memory, and one announcement on several speakers is
  synthesized once.
- The **connection status** checks the key and the voice, and shows the
  credits left and their renewal date. A refused key or an unknown voice stops
  the requests until the configuration changes.

Limit: with any text-to-speech integration, Gladys serves the audio on the
local network over `http://`, so the voice assistant in the (HTTPS) browser
page answers in text only. Speakers are not affected.

## Install

- **From Gladys**: install **ElevenLabs** from the integration store (Gladys
  5.3.0 or later), follow the configuration screen, then select it as the voice
  on the Artificial Intelligence page.
- **Development**: run it outside Docker against a local Gladys, see
  [Run locally](#run-locally).

## Configuration

| Field              | Description                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| API key            | Created at [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys).                                               |
| Voice (name or id) | A voice of the account: its name (`George` by default) or its 20-character id.                                                               |
| Model              | `eleven_flash_v2_5` (default, half the credits), `eleven_multilingual_v2`, `eleven_v3`, `eleven_v4` or `eleven_v4_turbo` (half the credits). |
| Speed              | 0.7 to 1.2, 1 by default.                                                                                                                    |
| Stability          | 0 (more expressive) to 1 (steadier), 0.5 by default.                                                                                         |

A restricted key needs the **Text to Speech** permission, **Voices: read** to
find a voice by its name, and **User: read** to show the credits.

Full user documentation, including troubleshooting:
[`docs/en.md`](./docs/en.md) / [`docs/fr.md`](./docs/fr.md).

## Development

Requires Node.js 20 or later.

```bash
npm ci
npm test               # unit tests (node --test)
npm run lint           # ESLint
npm run format:check   # Prettier
npm run coverage       # tests + coverage thresholds (needs Node >= 22.8)
```

Validate the manifest with the store's checker:

```bash
npx github:GladysAssistant/integration-store .
```

### Check against the real ElevenLabs API

Without Gladys: put your settings in `.env` (ignored by git), then run
`npm run smoke`. It checks the key and the voice, lists the voices, then
synthesizes one sentence (a few dozen credits) and saves it as an MP3 in the
temporary directory, through the same code Gladys drives.

```bash
ELEVENLABS_API_KEY=<API key>
ELEVENLABS_VOICE=<optional, voice name or id>
ELEVENLABS_MODEL=<optional, model id>
```

### Run locally

Register the integration in development mode in a Gladys 5.3+ server to get
its token and selector, then:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="<selector>" \
LOG_LEVEL=debug \
npm start
```

## Architecture

```
├─ index.js                          # creates the SDK client, registers the handlers, connects
├─ src/
│  ├─ app.js                         # registerHandlers: TTS, "List my voices", config, lifecycle
│  ├─ integration.js                 # ElevenLabsIntegration: voice lookup, status, synthesis, voice list
│  ├─ config.js                      # configuration: trim, defaults, ranges, models, language code
│  ├─ clip-cache.js                  # in-memory LRU of the clips already synthesized
│  ├─ lifecycle.js                   # unhandled-rejection exit
│  └─ elevenlabs/
│     └─ client.js                   # ElevenLabs HTTP API client, errors and user-facing messages
├─ scripts/smoke.mjs                 # manual check against the real ElevenLabs API (npm run smoke)
├─ test/                             # node:test unit tests (fake Gladys, fake ElevenLabs)
├─ docs/{en,fr}.md                   # user documentation (shown in the Gladys catalog)
├─ gladys-assistant-integration.json # manifest
└─ Dockerfile                        # image run by the Gladys supervisor
```

## Synced files

`.github/workflows/`, `.github/dependabot.yml`, `SECURITY.md` and `CLAUDE.md`
are synced from [cicoub13/integration-kit](https://github.com/cicoub13/integration-kit).
Do not edit them here: the next sync overwrites local changes. Change the
templates in integration-kit instead.

## License

Apache-2.0
