# Hotpod – lib-jitsi-meet Local Recording PoC

Hotpod is a browser-only proof of concept built on top of [lib-jitsi-meet](https://github.com/jitsi/lib-jitsi-meet). It focuses on
low-friction podcast recordings where every participant captures their own track locally while staying in sync with a shared host
controller. The project replaces the original ljm-getting-started demo with a feature-complete session experience that reflects the
product direction described in the PoC brief.

## Key capabilities

- **Host-driven capture.** Only the host link can trigger `REC_START`/`REC_STOP`; every connected client reacts deterministically.
- **Per-track local recording.** Each remote and local audio track is recorded in a dedicated `MediaRecorder` pipeline using WebM/Opus.
- **Spontaneous participants.** Late joiners during an active recording are automatically enrolled and start capturing immediately.
- **Chunked buffering.** Recorders persist two-second chunks and merge them into a downloadable file when recording stops.
- **Consistent exports.** Downloads follow `podcast_<room>_<participantId>_<displayName>_<startISO>.webm`, plus an optional metadata sidecar.
- **Safeguards.** Consent must be granted before joining, reloads while recording are guarded, and telemetry hooks remain local-only.
- **Browser-first onboarding.** The landing experience links to host/guest invites, device checks, and compliance reminders without server changes.

## Quick start

1. Install dependencies and build assets:

   ```bash
   npm install
   npm start
   ```

2. Open the dev server (default `http://localhost:8000`) and supply your JaaS App ID, room, and JWT.
3. Copy the generated invite URLs:
   - Host: `?room=<roomId>&host=1`
   - Guest: `?room=<roomId>`
4. Confirm the consent checkbox, select your microphone, and join.
5. As host, start/stop recording to trigger synchronized local captures. Each participant exports stems after the stop command.

> **Tip:** You can pre-populate credentials by setting `window.HOTPOD_CONFIG` in `www/index.html` (see [Configuration](#configuration)).

## Session flow

| Step | Host | Guests |
| ---- | ---- | ------ |
| 1 | Share host/guest links with the `room` query parameter. | Open the guest link. |
| 2 | Complete the consent flow and join. | Select a microphone, grant consent, and join. |
| 3 | Use the host controls to start the recording. | Receive the `REC_START` command and begin local capture. |
| 4 | Stop the recording; files export automatically. | Exports become available for download. |
| 5 | Download individual stems and optional metadata for downstream editing. | Same as host. |

Reloads while recording display a warning and require explicit confirmation to avoid data loss.

## Recording architecture

- **Session controller.** Wraps lib-jitsi-meet, handles join/leave, dispatches track lifecycle events, and uses endpoint messages for
  `REC_START`/`REC_STOP` broadcasting with idempotent handling.
- **Recording manager.** Maintains the `idle → recording → stopping → exported` lifecycle per track, including chunk counting, metadata
  timestamps, and host-triggered sidecar generation.
- **UI shell.** A minimal SPA provides routing via query parameters, consent gating, level metering, host controls, export listings,
  and invite link helpers.
- **Telemetry hooks.** Optional local telemetry buffers state transitions and can be toggled through configuration. No PII is collected
  or transmitted.

## Export artifacts

Every recorded participant receives:

- `podcast_<room>_<participantId>_<displayName>_<startISO>.webm` – the raw Opus stem.
- `podcast_<room>_<startISO>_metadata.json` – optional metadata with participant identities, start/stop timestamps, chunk counts,
  and the configured signalling domain. Hosted inside the Exports panel when all stems finish processing.

Metadata and filenames are sanitized to ASCII-safe components and suitable for ingestion by downstream DAWs.

## Browser compatibility

- **Chromium (Chrome, Edge, Brave) & Firefox:** Fully supported.
- **Safari:** Marked as experimental. The UI surfaces a warning but allows joining; falling back to Chromium or Firefox is recommended
  for production sessions.
- **Reload safeguards:** `beforeunload` guards prevent accidental tab closures while recording.

## Configuration

`www/index.html` injects a `window.HOTPOD_CONFIG` object that the app reads at runtime:

```js
window.HOTPOD_CONFIG = {
    domain: '8x8.vc',
    defaultAppId: 'vpaas-magic-cookie-1234',
    defaultJwt: '<your token>',
    telemetry: { enabled: false }
};
```

Adjust the values to prefill the setup wizard and toggle telemetry. No server-side changes to the Jitsi stack are required.

## Telemetry (optional)

When enabled, the Telemetry panel exposes a local-only event log with timestamps and payloads for:

- Participant join/leave events.
- Signalling sends/receives for `REC_START`/`REC_STOP`.
- Recording state transitions, exports, and sidecar creation.

The buffer never leaves the browser and is designed for debugging.

## Known limitations & compliance reminders

- No uploader or cloud sync; downloads stay local to the browser.
- No server-side mixing, mastering, or transcoding.
- Safari support is best-effort only (no hard block, but quality varies).
- Host permissions rely on the `host=1` query parameter; implement stronger auth for production.
- Always present the consent dialog and follow regional recording regulations.
- Warn users that closing the tab mid-recording will lose audio not yet exported.

## Additional lib-jitsi-meet resources

Consult the upstream [lib-jitsi-meet handbook](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-ljm-api) for deeper API
documentation, connection options, and advanced meeting features.
