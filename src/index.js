// App global state.
//

const state = {
    appId: '',
    room: '',
    jwt: '',
    conference: undefined,
    recordings: new Map(),
    recordingHandlers: [],
};

// Form elements.
//

const appIdEl = document.getElementById('appIdText');
const roomEl = document.getElementById('roomText');
const jwtEl = document.getElementById('jwtText');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const recordingsSectionEl = document.getElementById('recordingsSection');
const recordingsListEl = document.getElementById('recordingsList');
const recordingsEmptyStateEl = document.getElementById('recordingsEmptyState');

const RECORDER_CHUNK_EVENTS = [
    'RECORDER_DATA_AVAILABLE',
    'RECORDER_CHUNK_RECEIVED',
    'RECORDER_CHUNK_AVAILABLE',
    'RECORDER_NEW_CHUNK',
];

const RECORDER_STOP_STATES = [ 'REC_STOP', 'REC_STOPPED' ];
const RECORDER_START_STATES = [ 'REC_START', 'REC_STARTED' ];
const RECORDER_ABORT_STATES = [ 'REC_ABORT', 'REC_ABORTED' ];

const DEFAULT_RECORDING_MIME_TYPE = 'video/webm';

function updateJoinForm() {
    // In a meeting.
    if (state.conference) {
        appIdEl.disabled = true;
        roomEl.disabled = true;
        jwtEl.disabled = true;
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
    } else {
        appIdEl.disabled = false;
        roomEl.disabled = false;
        jwtEl.disabled = false;
        joinBtn.disabled = state.appId.length === 0 || state.room.length === 0 || state.jwt.length === 0;
        leaveBtn.disabled = true;
    }
}

updateJoinForm();

appIdEl.onchange = () => {
    state.appId = appIdEl.value.trim();
    updateJoinForm();
}

roomEl.onchange = () => {
    state.room = roomEl.value.trim();
    updateJoinForm();
}

jwtEl.onchange = () => {
    state.jwt = jwtEl.value.trim();
    updateJoinForm();
}

joinBtn.onclick = async () => {
    await connect();
    updateJoinForm();
};

leaveBtn.onclick = async () => {
    await leave();
    updateJoinForm();
};


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

const handleTrackRemoved = track => {
    track.dispose();
    document.getElementById(track.getId())?.remove();
};

const onConferenceJoined = () => {
    console.log('conference joined!');
};

const onConferenceLeft = () => {
    console.log('conference left!');
};

const onUserJoined = id => {
    console.log('user joined!', id);
};

const onUserLeft = id => {
    console.log('user left!', id);
};

const escapeFilenameToken = value => {
    if (!value || typeof value !== 'string') {
        return 'unknown';
    }

    return value
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-_]/g, '')
        .slice(0, 120) || 'unknown';
};

const buildRecordingBasename = recording => {
    const roomToken = escapeFilenameToken(recording.room || state.room || 'room');
    const participantToken = escapeFilenameToken(recording.participantId || 'participant');
    const nameToken = escapeFilenameToken(recording.displayName || 'guest');
    const startIso = (recording.startTimestamp
        ? new Date(recording.startTimestamp)
        : new Date()).toISOString().replace(/[:.]/g, '-');

    return `podcast_${roomToken}_${participantToken}_${nameToken}_${startIso}`;
};

const ensureRecordingEntry = (id, payload = {}) => {
    const key = id
        || payload.sessionId
        || payload.sessionID
        || payload.recorderSessionId
        || payload.recorderSessionID
        || payload.participantId
        || payload.id
        || `recorder-${Date.now()}`;

    let recording = state.recordings.get(key);

    if (!recording) {
        recording = {
            id: key,
            room: payload.room || state.room,
            participantId: payload.participantId
                || payload.participant?.id
                || payload.participantID
                || 'participant',
            displayName: payload.displayName
                || payload.participant?.name
                || payload.participantName
                || 'Guest',
            startTimestamp: payload.startTimestamp
                || payload.timestamp
                || Date.now(),
            stopTimestamp: undefined,
            browserInfo: payload.browserInfo
                || payload.clientInfo,
            mimeType: payload.mimeType,
            chunks: [],
            chunkMetadata: [],
            ready: false,
            error: undefined,
            blobUrl: undefined,
            sidecarUrl: undefined,
        };

        state.recordings.set(key, recording);
    } else {
        if (!recording.participantId && payload.participantId) {
            recording.participantId = payload.participantId;
        }
        if (!recording.displayName && payload.displayName) {
            recording.displayName = payload.displayName;
        }
        if (!recording.browserInfo && (payload.browserInfo || payload.clientInfo)) {
            recording.browserInfo = payload.browserInfo || payload.clientInfo;
        }
        if (!recording.mimeType && payload.mimeType) {
            recording.mimeType = payload.mimeType;
        }
        if (!recording.room && payload.room) {
            recording.room = payload.room;
        }
    }

    return recording;
};

const renderRecordings = () => {
    if (!recordingsListEl || !recordingsSectionEl || !recordingsEmptyStateEl) {
        return;
    }

    const recordings = Array.from(state.recordings.values())
        .sort((a, b) => (a.startTimestamp || 0) - (b.startTimestamp || 0));

    recordingsListEl.innerHTML = '';

    if (recordings.length === 0) {
        recordingsSectionEl.classList.add('d-none');
        recordingsEmptyStateEl.classList.remove('d-none');
        return;
    }

    recordingsSectionEl.classList.remove('d-none');
    recordingsEmptyStateEl.classList.add('d-none');

    recordings.forEach(recording => {
        const item = document.createElement('div');
        item.className = 'list-group-item flex-column align-items-start';

        const header = document.createElement('div');
        header.className = 'd-flex w-100 flex-wrap align-items-center justify-content-between gap-2';

        const title = document.createElement('div');
        title.className = 'd-flex flex-column flex-sm-row align-items-sm-center gap-2';

        const nameStrong = document.createElement('strong');
        nameStrong.textContent = recording.displayName || 'Guest';
        title.appendChild(nameStrong);

        const participantBadge = document.createElement('span');
        participantBadge.className = 'badge text-bg-secondary';
        participantBadge.textContent = recording.participantId || 'participant';
        title.appendChild(participantBadge);

        header.appendChild(title);

        const rightSide = document.createElement('div');
        rightSide.className = 'd-flex align-items-center gap-2 flex-wrap';

        if (recording.error) {
            const errorBadge = document.createElement('span');
            errorBadge.className = 'badge text-bg-danger';
            errorBadge.textContent = recording.error;
            rightSide.appendChild(errorBadge);
        } else if (!recording.ready) {
            const collectingBadge = document.createElement('span');
            collectingBadge.className = 'badge text-bg-warning text-wrap';
            collectingBadge.textContent = `Collecting recorder chunks (${recording.chunks.length})`;
            rightSide.appendChild(collectingBadge);
        } else {
            const downloadBtn = document.createElement('a');
            downloadBtn.className = 'btn btn-sm btn-success';
            downloadBtn.href = recording.blobUrl;
            downloadBtn.download = recording.fileName;
            downloadBtn.textContent = 'Download WEBM';
            rightSide.appendChild(downloadBtn);

            if (recording.sidecarUrl) {
                const sidecarBtn = document.createElement('a');
                sidecarBtn.className = 'btn btn-sm btn-outline-secondary';
                sidecarBtn.href = recording.sidecarUrl;
                sidecarBtn.download = `${recording.basename}.json`;
                sidecarBtn.textContent = 'Download metadata';
                rightSide.appendChild(sidecarBtn);
            }
        }

        header.appendChild(rightSide);
        item.appendChild(header);

        const metaList = document.createElement('div');
        metaList.className = 'small text-muted mt-2';

        const startTime = recording.startTimestamp
            ? new Date(recording.startTimestamp).toLocaleString()
            : '—';
        const stopTime = recording.stopTimestamp
            ? new Date(recording.stopTimestamp).toLocaleString()
            : recording.ready
                ? new Date().toLocaleString()
                : '—';

        metaList.textContent = `Start: ${startTime} · Stop: ${stopTime} · Chunks: ${recording.chunks.length}`;

        item.appendChild(metaList);
        recordingsListEl.appendChild(item);
    });
};

const resetRecordings = () => {
    state.recordings.forEach(recording => {
        if (recording.blobUrl) {
            URL.revokeObjectURL(recording.blobUrl);
        }
        if (recording.sidecarUrl) {
            URL.revokeObjectURL(recording.sidecarUrl);
        }
    });

    state.recordings.clear();
    renderRecordings();
};

const recordChunkMetadata = (recording, payload, blob) => {
    recording.chunkMetadata.push({
        index: payload.chunkIndex
            ?? payload.index
            ?? payload.sequenceNumber
            ?? recording.chunkMetadata.length,
        receivedAt: new Date().toISOString(),
        startTimestamp: payload.chunkStart
            ?? payload.chunkStartTime
            ?? payload.startTimestamp
            ?? null,
        endTimestamp: payload.chunkEnd
            ?? payload.chunkEndTime
            ?? payload.endTimestamp
            ?? null,
        size: blob?.size ?? null,
    });
};

const extractChunkBlob = payload => {
    if (!payload) {
        return undefined;
    }

    const candidates = [
        payload.data,
        payload.chunk,
        payload.blob,
        payload.buffer,
        payload.chunkData,
        payload.payload,
    ];

    const blobCandidate = candidates.find(candidate => candidate instanceof Blob);

    if (blobCandidate) {
        return blobCandidate;
    }

    const arrayBufferCandidate = candidates.find(candidate => candidate instanceof ArrayBuffer);

    if (arrayBufferCandidate) {
        return new Blob([ arrayBufferCandidate ], { type: payload.mimeType || DEFAULT_RECORDING_MIME_TYPE });
    }

    if (payload.base64) {
        const binary = (typeof atob === 'function'
            ? atob(payload.base64)
            : globalThis?.atob?.(payload.base64));

        if (!binary) {
            console.warn('Failed to decode recorder chunk from base64 payload');
            return undefined;
        }
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }

        return new Blob([ bytes ], { type: payload.mimeType || DEFAULT_RECORDING_MIME_TYPE });
    }

    return undefined;
};

const finalizeRecording = recording => {
    if (!recording.chunks.length) {
        recording.error = recording.error || 'No recorder chunks received';
        renderRecordings();
        return;
    }

    const mimeType = recording.mimeType || (recording.chunks[0]?.type || DEFAULT_RECORDING_MIME_TYPE);
    const blob = new Blob(recording.chunks, { type: mimeType });
    const basename = buildRecordingBasename(recording);

    if (recording.blobUrl) {
        URL.revokeObjectURL(recording.blobUrl);
    }
    if (recording.sidecarUrl) {
        URL.revokeObjectURL(recording.sidecarUrl);
    }

    recording.mimeType = mimeType;
    recording.fileName = `${basename}.webm`;
    recording.basename = basename;
    recording.blobUrl = URL.createObjectURL(blob);
    recording.ready = true;

    const sidecar = {
        room: recording.room || state.room,
        participantId: recording.participantId,
        displayName: recording.displayName,
        startTimestamp: recording.startTimestamp
            ? new Date(recording.startTimestamp).toISOString()
            : null,
        stopTimestamp: recording.stopTimestamp
            ? new Date(recording.stopTimestamp).toISOString()
            : null,
        browserInfo: recording.browserInfo || null,
        chunkCount: recording.chunks.length,
        chunks: recording.chunkMetadata,
        mimeType,
    };

    const sidecarBlob = new Blob([
        `${JSON.stringify(sidecar, null, 2)}\n`,
    ], { type: 'application/json' });

    recording.sidecarUrl = URL.createObjectURL(sidecarBlob);

    renderRecordings();
};

const getConferenceEventName = names => {
    if (!Array.isArray(names)) {
        return undefined;
    }

    const conferenceEvents = JitsiMeetJS?.events?.conference;

    if (!conferenceEvents) {
        return undefined;
    }

    const key = names.find(name => conferenceEvents[name]);

    if (!key) {
        return undefined;
    }

    return conferenceEvents[key];
};

const bindRecordingHandlers = conference => {
    const conferenceEvents = JitsiMeetJS?.events?.conference;

    if (!conferenceEvents) {
        console.warn('Recorder events unavailable: conference events missing');
        return;
    }

    const stateEventName = conferenceEvents.RECORDER_STATE_CHANGED
        || conferenceEvents.RECORDER_STATE_CHANGE
        || conferenceEvents.RECORDER_STATE;

    if (stateEventName) {
        const handler = payload => {
            const recording = ensureRecordingEntry(payload?.sessionId, payload);

            if (RECORDER_START_STATES.includes(payload?.state)) {
                if (recording.ready) {
                    if (recording.blobUrl) {
                        URL.revokeObjectURL(recording.blobUrl);
                        recording.blobUrl = undefined;
                    }
                    if (recording.sidecarUrl) {
                        URL.revokeObjectURL(recording.sidecarUrl);
                        recording.sidecarUrl = undefined;
                    }

                    recording.chunks = [];
                    recording.chunkMetadata = [];
                }

                recording.startTimestamp = payload.startTimestamp
                    || payload.timestamp
                    || recording.startTimestamp
                    || Date.now();
                recording.error = undefined;
                recording.ready = false;
                recording.stopTimestamp = undefined;
                renderRecordings();
            } else if (RECORDER_STOP_STATES.includes(payload?.state)) {
                recording.stopTimestamp = payload.stopTimestamp
                    || payload.timestamp
                    || Date.now();
                finalizeRecording(recording);
            } else if (RECORDER_ABORT_STATES.includes(payload?.state)) {
                recording.stopTimestamp = payload.stopTimestamp
                    || payload.timestamp
                    || Date.now();
                recording.error = 'Recorder aborted';
                recording.ready = false;
                renderRecordings();
            }
        };

        conference.on(stateEventName, handler);
        state.recordingHandlers.push([ stateEventName, handler ]);
    }

    const chunkEventName = getConferenceEventName(RECORDER_CHUNK_EVENTS);

    if (chunkEventName) {
        const handler = payload => {
            const recording = ensureRecordingEntry(payload?.sessionId, payload);
            const blob = extractChunkBlob(payload);

            if (!blob) {
                console.warn('Recorder chunk payload missing blob data', payload);
                return;
            }

            if (!recording.mimeType && blob.type) {
                recording.mimeType = blob.type;
            }

            recording.chunks.push(blob);
            recordChunkMetadata(recording, payload, blob);

            renderRecordings();
        };

        conference.on(chunkEventName, handler);
        state.recordingHandlers.push([ chunkEventName, handler ]);
    } else {
        console.warn('Recorder chunk events unavailable');
    }
};

const cleanupRecordingHandlers = () => {
    if (!state.conference || !state.recordingHandlers.length) {
        state.recordingHandlers = [];
        return;
    }

    state.recordingHandlers.forEach(([ eventName, handler ]) => {
        try {
            state.conference.off(eventName, handler);
        } catch (err) {
            console.warn('Failed to detach recorder handler', eventName, err);
        }
    });

    state.recordingHandlers = [];
};

async function connect() {
    // Create local tracks
    const localTracks = await JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] });
    const joinOptions = {
        tracks: localTracks,
    };
    const c = await JitsiMeetJS.joinConference(state.room, state.appId, state.jwt, joinOptions);

    c.on(
        JitsiMeetJS.events.conference.TRACK_ADDED,
        handleTrackAdded);
    c.on(
        JitsiMeetJS.events.conference.TRACK_REMOVED,
        handleTrackRemoved);
    c.on(
        JitsiMeetJS.events.conference.CONFERENCE_JOINED,
        onConferenceJoined);
    c.on(
        JitsiMeetJS.events.conference.CONFERENCE_LEFT,
        onConferenceLeft);
    c.on(
        JitsiMeetJS.events.conference.USER_JOINED,
        onUserJoined);
    c.on(
        JitsiMeetJS.events.conference.USER_LEFT,
        onUserLeft);

    bindRecordingHandlers(c);

    state.conference = c;
    renderRecordings();
}

// Leave the room and proceed to cleanup.
async function leave() {
    if (state.conference) {
        cleanupRecordingHandlers();
        await state.conference.dispose();
    }

    state.conference = undefined;
    resetRecordings();
}

// Initialize library.
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);

renderRecordings();
