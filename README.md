# Hotpod lib-jitsi-meet Demo

Hotpod is a minimal sample application that demonstrates how to embed the low-level `lib-jitsi-meet` APIs inside a custom UI. The codebase focuses on showcasing authentication with a JaaS (Jitsi as a Service) app, joining a meeting, and rendering remote media with as little scaffolding as possible so it can be adapted into other products quickly.

## Prerequisites

- Node.js 18 LTS or later.
- npm 9 or later (bundled with Node.js 18+).
- A valid JaaS application ID and JSON Web Token (JWT) that grants access to the desired room.
- Browser devices with working microphone and camera hardware for end-to-end validation.

## Local development setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server. The bundled esbuild watcher recompiles on every save and serves static assets from `www/`:
   ```bash
   npm start
   ```
3. Open the served demo at the URL printed in the terminal (default: `http://127.0.0.1:8000`).
4. Provide your credentials in the Join form:
   - **JaaS App ID** – the application identifier from the 8x8 admin console.
   - **Room** – the name of the room you want to join.
   - **JWT** – a short-lived access token. Tokens must be generated server-side; never embed production secrets into the client bundle.
5. Press **Join** to connect or **Leave** to dispose of the conference and release tracks.

## Configuration reference

The UI maps directly to the parameters expected by `lib-jitsi-meet`:

| Field / option          | Location     | Description |
| ----------------------- | ------------ | ----------- |
| `appId`                 | Join form    | Passed to `JitsiMeetJS.joinConference` to select the correct JaaS tenant. |
| `room`                  | Join form    | Room slug. Avoid spaces; use the same identifier used when creating the JWT. |
| `jwt`                   | Join form    | Bearer token for authentication and authorization. Generate per-session on the server. |
| Local media constraints | `src/index.js` | `JitsiMeetJS.createLocalTracks({ devices: ['audio', 'video'] })` requests default 720p@30fps video and microphone access. Adjust before bundling for production. |

Other toggles—such as enabling recording or breakout rooms—must be configured via the JaaS backend; this demo intentionally limits the surface area to ease portability.

## Desktop browser test matrix

| Browser (engine) | Version | OS / Hardware              | Status | Notes |
| ---------------- | ------- | -------------------------- | ------ | ----- |
| Chrome (Chromium) | 121.x  | Windows 11 (22H2), Intel   | ✅ Full support | Covers screen share, device switching, and JWT re-authentication. |
| Edge (Chromium)   | 121.x  | Windows 11 (22H2), Intel   | ✅ Full support | Shares engine with Chrome; exercised separate device profile to verify Widevine prompts. |
| Firefox           | 121.x  | Windows 11 (22H2), Intel   | ✅ Full support | Requires allowing camera/mic permissions per session. |
| Chrome (Chromium) | 121.x  | macOS 14.3 (Apple Silicon) | ✅ Full support | Tested with Continuity Camera; handoff works. |
| Edge (Chromium)   | 121.x  | macOS 14.3 (Apple Silicon) | ✅ Full support | Uses Microsoft auto-update channel. |
| Firefox           | 121.x  | macOS 14.3 (Apple Silicon) | ✅ Full support | No additional configuration required. |
| Chrome (Chromium) | 121.x  | Ubuntu 22.04 (Wayland)     | ✅ Full support | Ensure `xdg-desktop-portal` is present for screen sharing prompts. |
| Firefox           | 121.x  | Ubuntu 22.04 (Wayland)     | ✅ Full support | Screen share requires selecting the “Entire Screen” surface. |

Run smoke tests on each target before shipping changes that touch media, device enumeration, or authentication flows. Record outcomes in your release checklist so regressions can be traced quickly.

## Safari support policy

Safari (macOS and iOS/iPadOS) is not part of the primary support matrix because of the following engine limitations that impact this demo:

- Lack of VP9 hardware decode and slow H.264 simulcast renegotiation causes initial join latency spikes on large rooms.
- Screen-sharing prompts on macOS Safari 17.x frequently fail to surface when the page is loaded from `localhost` unless the user manually adds the site under **System Settings → Privacy & Security → Screen Recording**.
- `getDisplayMedia` fails silently on iOS/iPadOS 17.x, preventing presenter mode entirely.

Given that the core flows (audio/video join, chat) work after manual intervention, expose the Safari build behind a **Beta badge** rather than a hard feature flag. The Beta badge communicates the reduced confidence level while still allowing early adopters to validate flows. Pair the badge with inline help that links to troubleshooting steps for screen sharing and permission resets.

## Privacy and data handling

- All media routing and authentication is delegated to the configured JaaS deployment; no Hotpod-specific servers store meeting metadata or media.
- JWTs must be minted by your backend immediately before use and scoped to a single room. Do not log or cache tokens inside the demo application.
- The sample UI does **not** include a file uploader. Avoid transmitting personal data through chat or screen sharing if your compliance posture requires data residency guarantees; instead, instruct participants to use pre-approved storage providers and share links within the meeting.
- Review your organization’s privacy notice before distributing the demo, and update copy to reflect how meeting artifacts (recordings, transcripts, analytics) are handled by the underlying Jitsi infrastructure.

## Known limitations and workarounds

- **No built-in file uploader** – Users should rely on external storage (e.g., SharePoint, Google Drive) and paste access-controlled links into chat. Consider integrating with those APIs if secure file transfer is mandatory.
- **Manual credential entry** – The form does not persist tokens. Automate JWT retrieval by wiring the form to your backend or by injecting the token via query parameters during internal testing.
- **Safari Beta support** – When enabling the Safari Beta badge, include documentation that instructs users to reset camera/microphone permissions through `Preferences → Websites → Camera/Microphone` if tracks fail to publish.
- **No analytics or moderation UI** – Advanced controls (recording, breakout rooms, moderation) must be triggered via the JaaS REST APIs or the official Jitsi web client.

Contributions are welcome—open an issue describing the scenario you want to cover, along with the browsers and devices you have already exercised.
