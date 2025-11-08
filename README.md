# Getting started with lib-jitsi-meet

## Overview

lib-jitsi-meet (LJM henceforth) is the core library used my Jitsi Meet which implements
all signalling, codec management and takes good care of all the idiosyncrasies in WebRTC.

While it's a low-level library, specially compared to our iframe API, it packs a lot
of functionality not generally seen in low-level libraries:

- Full signalling: the concept of "rooms" and "users" is built right in, there is no
  need for applications to develop their own abstractions.
- Chat: it's at the core of the LJM signalling.
- 1-to-1 vs group calls: LJM treats every call as a group call, but it implements
  specific optimizations for the 1-to-1 call case.
- Signalling back channel: applications may want to leverage the signalling channel
  to send arbitrary data.
- Advanced meeting features: breakout rooms, advanced analytics, and more.

### To go or not to go low-level

It's tempting to want to use a low level library like LJM for maximum flexibility
but that comes at a cost. Developing the UI and UX for a meetings product is not
an easy feat, there are many things that need to be taken into consideration
and it's not "just" putting some tiles on the screen.

Unless you are building a product where the actual meeting is the center piece of it,
like a meetings product in itself, we recommend starting off with the high-level
API using an iframe.

Please refer to the [IFrame API](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe) for more details.

### Integrating LJM into your web app

If you have decided to use the low level API, you are in the right place! This document contains
a walkthrough of the basics. If you want to run the sample code here, run the following:

```js
git clone https://github.com/jitsi/ljm-getting-started.git
cd ljm-getting-started
npm install
npm start
```

The built site will be available in https://localhost:8000

Now let's dive right in!

----

## Usage guidelines and current limitations

- **Obtain explicit participant consent.** The host is responsible for presenting the
  consent dialog before anyone joins recording-enabled meetings and for reiterating that
  they are acting in the dedicated host role throughout the session.
- **Browser support.** Safari currently lacks full support for the demo mixing flow. The
  in-app join controls are disabled in Safari and the recommended fallback is to direct
  participants to a Chromium-based browser (Chrome, Edge, Brave) or Firefox instead.
- **Post-processing.** Multitrack mastering, normalization, and mastering-grade effects are
  out of scope for the demo. Export your raw stems and perform the final mixdown in an
  external Digital Audio Workstation (DAW) such as Logic Pro, Ableton, or Reaper.

----

In order to get started working with LJM the first step is to load and initialize
the library.

First, add LJM to your HTML file (or dynamically load it via JavaScript):

```html
<script src="https://8x8.vc/libs/lib-jitsi-meet.min.js"></script>
```

Then, in your application code, initialize it:

```js
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);
```

Great, you are now able to use LJM, let's go!

### Creating local audio and video tracks

lib-jitsi-meet provides a simple way for creating local audio and video tracks:

```js
const localTracks = await JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] });
```

This will create tracks with (sane) defaults, such as 720p@30fps for the video track. More
customization is possible with extra parameters.

### Creating a connection and joining a conference

Joining a conference is a 2 step process. First we need to create the connection to the signalling
server. Once the connection has been established, a conference can be joined.

#### Creating a connection

First, let's create a connection:

```js
    function buildOptions(appId, room) {
        return {
            hosts: {
                domain: '8x8.vc',
                muc: `conference.${appId}.8x8.vc`,
                focus: 'focus.8x8.vc'
            },
            serviceUrl: `wss://8x8.vc/${appId}/xmpp-websocket?room=${room}`,
            websocketKeepAliveUrl: `https://8x8.vc/${appId}/_unlock?room=${room}`,
        };
    }

    const options = buildOptions('vpaas-magic-cookie-1234', 'mytestroom');

    const connection = new JitsiMeetJS.JitsiConnection(null, jwt, options);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        onConnectionDisconnected);

    connection.connect();
```

Lots to unpack here!

In order to create a connection we need 2 things: a valid JWT token and the connection options.

The connection options must be built with the right JaaS app ID and room name or the connection will
fail. These are the simplest connection options possible.

```js
    function buildOptions(appId, room) {
        return {
            hosts: {
                domain: '8x8.vc',
                muc: `conference.${appId}.8x8.vc`
            },
            serviceUrl: `wss://8x8.vc/${appId}/xmpp-websocket?room=${room}`,
            websocketKeepAliveUrl: `https://8x8.vc/${appId}/_unlock?room=${room}`,
        };
    }
```

Now the connection can be created:

```js
const connection = new JitsiMeetJS.JitsiConnection(null, jwt, options);
```

The connection object emits events to track its progress, which will begin once `connect()` is
called. Let's add some event handlers and start connecting:

```js
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed);
    connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        onConnectionDisconnected);

    connection.connect();
```

When the connection is established the `onConnectionSuccess` handler that was registered will be called. At that
point we are ready to create a conference and join it.

#### Creating a conference

With an established connection we can create a conference, subscribe to its events and join it:

```js
    // Initialize conference
    const conference = connection.initJitsiConference(room, {});

    // Setup event listeners
    conference.on(
        JitsiMeetJS.events.conference.TRACK_ADDED,
        track => handleTrack(track, TrackOps.ADD));
    conference.on(
        JitsiMeetJS.events.conference.TRACK_REMOVED,
        track => handleTrack(track, TrackOps.REMOVE));
    conference.on(
        JitsiMeetJS.events.conference.CONFERENCE_JOINED,
        onConferenceJoined);
    conference.on(
        JitsiMeetJS.events.conference.CONFERENCE_LEFT,
        onConferenceLeft);
    conference.on(
        JitsiMeetJS.events.conference.USER_JOINED,
        onUserJoined);
    conference.on(
        JitsiMeetJS.events.conference.USER_LEFT,
        onUserLeft);

    // Add local tracks before joining
    for (const track of localTracks) {
        await conference.addTrack(track);
    }

    // Join
    conference.join();
```

Again, a few things to unpack here!

Analogously to the connection, first we'll initialize the conference, passing in the room name and
additional options:

```js
    const conference = connection.initJitsiConference(room, {});
```

At this point we can add event listeners and then join the conference:

```js
    // Setup event listeners
    conference.on(
        JitsiMeetJS.events.conference.TRACK_ADDED,
        track => handleTrack(track, TrackOps.ADD));
    conference.on(
        JitsiMeetJS.events.conference.TRACK_REMOVED,
        track => handleTrack(track, TrackOps.REMOVE));
    conference.on(
        JitsiMeetJS.events.conference.CONFERENCE_JOINED,
        onConferenceJoined);
    conference.on(
        JitsiMeetJS.events.conference.CONFERENCE_LEFT,
        onConferenceLeft);
    conference.on(
        JitsiMeetJS.events.conference.USER_JOINED,
        onUserJoined);
    conference.on(
        JitsiMeetJS.events.conference.USER_LEFT,
        onUserLeft);

    // Add local tracks before joining
    for (const track of localTracks) {
        await conference.addTrack(track);
    }

    // Join
    conference.join();
```

Note how the local tracks are added to the conference at this stage, before joining it. This will make the
initial join faster!

At this point, `onConferenceJoined` will be called once the conference has been joined. Success!


#### Rendering local and remote audio / video

So, we have a connection and a conference, but how do we receive remote audio and video tracks? The conference `TRACK_ADDED`
event will be fired when a track is added to it. This also applies to local tracks, so it can be used to display both local and
remote video, but watch out and don't play the local audio back!

First, let's look at how to handle a new track that was added:

```js
const handleTrackAdded = track => {
    if (track.getType() === 'video') {
        const meetingGrid = document.getElementById('meeting-grid');
        const videoNode = document.createElement('video');

        videoNode.id = track.getId();
        videoNode.className = 'jitsiTrack col-4 p-1';
        videoNode.autoplay = true;
        meetingGrid.appendChild(videoNode);
        track.attach(videoNode);
    } else if (!track.isLocal()) {
        const audioNode = document.createElement('audio');

        audioNode.id = track.getId();
        audioNode.className = 'jitsiTrack';
        audioNode.autoplay = true;
        document.body.appendChild(audioNode);
        track.attach(audioNode);
    }
};
```

Here we are going to create an `<audio>` or `<video>` DOM element for the track, depending on its type. The Jitsi track
objects contain helpers for attaching them to DOM elements, so we'll leverage those to attach them so they are rendered.
For the purposes of this example, each of the created DOM elements will have an ID equal to the track ID, which is guaranteed
to be unique.

Now let's look at handling track removal, for example when a user leaves a conference:

```js
const handleTrackRemoved = track => {
    track.dispose();
    document.getElementById(track.getId())?.remove();
};
```

There is much lees to do in this case. First we'll dispose the track, which will free all resources attached to it, then remove
it from the
DOM entirely.

## That's it!

This guide goes through the basics for getting started with lib-jitsi-meet, more documentation can be found in the [Handbook](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-ljm-api).

---

# Hotpod lib-jitsi-meet Demo quickstart

The Hotpod sample UI wraps the walkthrough code above into a runnable demo focused on authentication with a JaaS (Jitsi as a Service) app, joining a conference, and rendering local / remote media. This section documents the project-specific setup, configuration, and operational guidance.

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

| Field / option          | Location       | Description |
| ----------------------- | -------------- | ----------- |
| `appId`                 | Join form      | Passed to `JitsiMeetJS.joinConference` to select the correct JaaS tenant. |
| `room`                  | Join form      | Room slug. Avoid spaces; use the same identifier used when creating the JWT. |
| `jwt`                   | Join form      | Bearer token for authentication and authorization. Generate per-session on the server. |
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
