# AGENTS.md: gladys-elevenlabs

Project-specific notes. Generic rules (SDK contract, commands, kit-owned files, runtime) are in
`CLAUDE.md`; the user-facing features are in `README.md`.

## Gladys contract (TTS provider)

- Manifest `type: tts` (Gladys ≥ 5.3.0, spec `docs/specs/external-integrations/capabilities/tts-type.md`
  in the Gladys repo): no devices, Configuration / Supervision / Logs screens only. An admin
  selects the integration as the voice of the instance in the "Voice (text-to-speech provider)"
  card of the Artificial Intelligence page (system variable `TTS_ACTIVE_PROVIDER`).
- `onTtsSynthesize(text, language)`: `text` ≤ 2,000 characters (capped by the core), `language`
  the requesting user's or, for a scene announcement, the first admin's; `null` when unknown.
  Resolve `audio/mpeg;base64,…` (≤ 5 MB decoded), within 30 s. The core keeps the clip in RAM
  10 min and hands speakers a LAN `http://` URL: the voice assistant in an HTTPS page stays
  text-only with any integration provider (mixed content), only speakers play it.
- No silent fallback: a stopped integration or a thrown error fails the scene action (logged
  by the scene), it never falls back to Gladys Plus.
- `config_schema` select options are static (`source` is only `devices` / `houses`), hence the
  `voice` free field (name or id) and the `list_voices` manifest action (`onAction`), whose
  string/`{en, fr}` result is shown under the button (`white-space: pre-wrap`, scrollable).

## Data flow

- `index.js` -> `registerHandlers` (`src/app.js`) -> `ElevenLabsIntegration` (`src/integration.js`).
- `applyConfig()` (on `connected` and `onConfigUpdated`) sets the client, `blocker` and the
  settings SYNCHRONOUSLY, bumps `generation`, clears the clip cache, then looks the voice up
  (`ensureVoice`) and reads the credits (`getSubscription`, optional: a restricted key may lack
  "User: read"). Never rejects. An outcome whose `generation` is stale changes nothing.
- Voice lookup: a 20-char `[A-Za-z0-9]` value is an id (`GET /v1/voices/{id}`; a 403 accepts the
  id unverified), anything else a name (`GET /v2/voices?search=`, exact name first, then the
  part before " - ": default voices are named "George - Warm, Captivating Storyteller").
  Concurrent callers share one lookup; a transient failure is retried by the next request.
- `blocker` ({en, fr} or null): no key, refused key, unknown voice, or a name with a key that
  cannot read voices (`voice_needs_id`). While set, synthesis throws without a request. Only a
  new configuration clears it.
- Synthesis: `ClipCache` (LRU, 16 MB / 100 clips, key = voice, model, language, settings,
  text) then `inFlight` (identical concurrent requests share one call: one announcement on
  several speakers). Channel-wide errors (key, voice, credits, permission, network, 5xx)
  become the connection status; a later success restores it. `rate_limited` and
  `invalid_request` fail that request only.
- A command arriving before the first `applyConfig` reads the config itself (`load()`).

## ElevenLabs API (`src/elevenlabs/client.js`)

- Auth header `xi-api-key`. `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`,
  JSON `{text, model_id, voice_settings: {speed, stability}, language_code?}` -> MP3 bytes.
  `language_code` only for `eleven_flash_v2_5` and `eleven_v3` (`MODELS` in `src/config.js`);
  `eleven_multilingual_v2` refuses it. Speed 0.7–1.2, stability 0–1.
- `GET /v2/voices` (`page_size` ≤ 100, `next_page_token`, `has_more`), `GET /v1/voices/{id}`,
  `GET /v1/user/subscription` (`character_count`, `character_limit`,
  `next_character_count_reset_unix`).
- Errors: `{"detail": {"code", "message", "status"}}` (`status` = legacy `code`), a string, or a
  422 list of `{loc, msg}`. 401 -> `invalid_key`, except legacy `quota_exceeded` and a
  restricted key missing a permission (a 401 `unauthorized` "missing the permission …", not the
  documented 403: seen live) -> `permission`. 402 /
  `insufficient_credits` -> `credits`, 403 -> `permission` (`model_access_denied`…), 404
  `voice_not_found`, 429 -> `rate_limited`, 5xx -> `server`.
- The key lives in a private field and is scrubbed (`***`) from error texts; labels drop the
  query string (a search holds what the user typed); the original fetch error is dropped (only
  `cause.code` kept). `test/client.test.js` asserts nothing leaks: keep it that way.
- Timeouts: 10 s for lookups, 25 s for a synthesis (the core waits 30 s).
- `eleven_v4*` models are listed in the ElevenLabs docs as Text to Dialogue only: not offered.

## Config and storage

- Keys are a compatibility contract: `api_key`, `voice`, `model`, `speed`, `stability`.
- Nothing is written to `/data`: clips stay in memory.

## Tests

- `test/integration.test.js` runs `registerHandlers` against the SDK fake Gladys
  (`fake.ttsSynthesize`, `fake.action`, `fake.configUpdated`, `fake.connectionStatuses`) with a
  scripted ElevenLabs client (outcome lists).
- `test/client.test.js` uses a recording `fakeFetch` returning real `Response` objects.
- `test/manifest.test.js` cross-checks the manifest with the code (keys, defaults, ranges,
  models, action handlers, version, image tag, cover): update both sides together.
- `npm run smoke` checks against the real API (see the README).
