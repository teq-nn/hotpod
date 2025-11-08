// App global state.
//

const state = {
    appId: '',
    room: '',
    jwt: '',
    conference: undefined,
    connectionStatus: 'disconnected',
    connectionMessage: '',
    recordingStatus: 'idle',
    recordingMessage: '',
    isRecording: false,
    localAudioLevel: 0,
    remoteAudioIndicators: new Map(),
    sessionActive: false,
};

const envConfig = window.__HOT_POD_ENV__ || {};

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return defaultValue;
}

const telemetryConfig = {
    enabled: parseBoolean(envConfig.HOT_POD_TELEMETRY_ENABLED, false),
    storageKey: envConfig.HOT_POD_TELEMETRY_STORAGE_KEY || 'hotpod:telemetry',
    enableRemoteAudioLevels: parseBoolean(envConfig.HOT_POD_REMOTE_LEVELS_ENABLED, false),
    maxEvents: Number.parseInt(envConfig.HOT_POD_TELEMETRY_MAX_EVENTS || '200', 10) || 200,
};

const recordingUnloadMessage = envConfig.HOT_POD_RECORDING_UNLOAD_MESSAGE
    || 'A recording is currently in progress. Leaving may result in data loss.';

const TELEMETRY_KEY = telemetryConfig.storageKey;
const MAX_TELEMETRY_EVENTS = telemetryConfig.maxEvents;

// Form elements.
//

const appIdEl = document.getElementById('appIdText');
const roomEl = document.getElementById('roomText');
const jwtEl = document.getElementById('jwtText');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const connectionStatusBanner = document.getElementById('connectionStatusBanner');
const recordingStatusBanner = document.getElementById('recordingStatusBanner');
const localAudioLevelBar = document.getElementById('localAudioLevelBar');
const remoteAudioLevelsSection = document.getElementById('remoteAudioLevels');
const remoteAudioLevelGrid = document.getElementById('remoteAudioLevelGrid');

if (!telemetryConfig.enableRemoteAudioLevels && remoteAudioLevelsSection) {
    remoteAudioLevelsSection.remove();
}

function clampPercent(value) {
    if (Number.isNaN(value)) {
        return 0;
    }
    return Math.min(100, Math.max(0, value));
}

function percentFromLevel(level) {
    return clampPercent(Math.round(Math.max(0, Math.min(1, level)) * 100));
}

function formatStatus(baseText, message) {
    if (message) {
        return `${baseText} — ${message}`;
    }
    return baseText;
}

function setConnectionStatus(status, message = '') {
    state.connectionStatus = status;
    state.connectionMessage = message;
    updateConnectionBanner();
}

function updateConnectionBanner() {
    if (!connectionStatusBanner) {
        return;
    }

    const statusMap = {
        disconnected: { className: 'alert-secondary text-dark', message: 'Disconnected' },
        connecting: { className: 'alert-info text-dark', message: 'Connecting…' },
        connected: { className: 'alert-success', message: 'Connected' },
        error: { className: 'alert-danger', message: 'Connection error' },
    };

    const current = statusMap[state.connectionStatus] || statusMap.disconnected;
    connectionStatusBanner.className = `alert ${current.className}`;
    connectionStatusBanner.textContent = formatStatus(current.message, state.connectionMessage);
}

function setRecordingStatus(status, message = '') {
    state.recordingStatus = status;
    state.recordingMessage = message;
    updateRecordingBanner();
}

function updateRecordingBanner() {
    if (!recordingStatusBanner) {
        return;
    }

    const statusMap = {
        idle: { className: 'alert-secondary text-dark', message: 'Recording idle' },
        pending: { className: 'alert-warning text-dark', message: 'Recording pending…' },
        recording: { className: 'alert-danger', message: 'Recording in progress' },
        stopped: { className: 'alert-info text-dark', message: 'Recording stopped' },
        error: { className: 'alert-danger', message: 'Recording error' },
    };

    const current = statusMap[state.recordingStatus] || statusMap.idle;
    recordingStatusBanner.className = `alert ${current.className}`;
    recordingStatusBanner.textContent = formatStatus(current.message, state.recordingMessage);
}

function updateLocalAudioLevel(level) {
    state.localAudioLevel = level;
    if (!localAudioLevelBar) {
        return;
    }

    const percent = percentFromLevel(level);
    localAudioLevelBar.style.width = `${percent}%`;
    localAudioLevelBar.setAttribute('aria-valuenow', String(percent));
    localAudioLevelBar.textContent = percent >= 15 ? `${percent}%` : '';
}

function ensureRemoteAudioLevelsVisible() {
    if (!telemetryConfig.enableRemoteAudioLevels || !remoteAudioLevelsSection) {
        return;
    }
    remoteAudioLevelsSection.hidden = state.remoteAudioIndicators.size === 0;
}

function createRemoteAudioIndicator(track) {
    if (!telemetryConfig.enableRemoteAudioLevels || !remoteAudioLevelGrid) {
        return;
    }

    const trackId = track.getId();
    if (state.remoteAudioIndicators.has(trackId)) {
        return;
    }

    const participantId = track.getParticipantId();
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6';
    col.dataset.trackId = trackId;

    const wrapper = document.createElement('div');
    wrapper.className = 'p-2 bg-body-secondary rounded';

    const title = document.createElement('div');
    title.className = 'small fw-semibold text-dark';
    title.textContent = participantId ? `Participant ${participantId}` : 'Remote participant';

    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');

    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    bar.style.width = '0%';
    progress.appendChild(bar);

    wrapper.appendChild(title);
    wrapper.appendChild(progress);
    col.appendChild(wrapper);
    remoteAudioLevelGrid.appendChild(col);

    state.remoteAudioIndicators.set(trackId, { container: col, bar });
    ensureRemoteAudioLevelsVisible();
}

function updateRemoteAudioIndicator(trackId, level) {
    if (!telemetryConfig.enableRemoteAudioLevels) {
        return;
    }

    const indicator = state.remoteAudioIndicators.get(trackId);
    if (!indicator) {
        return;
    }

    const percent = percentFromLevel(level);
    indicator.bar.style.width = `${percent}%`;
    indicator.bar.setAttribute('aria-valuenow', String(percent));
    indicator.bar.textContent = percent >= 15 ? `${percent}%` : '';
}

function removeRemoteAudioIndicator(trackId) {
    if (!telemetryConfig.enableRemoteAudioLevels) {
        return;
    }

    const indicator = state.remoteAudioIndicators.get(trackId);
    if (indicator) {
        indicator.container.remove();
        state.remoteAudioIndicators.delete(trackId);
    }
    ensureRemoteAudioLevelsVisible();
}

function clearRemoteAudioIndicators() {
    if (!telemetryConfig.enableRemoteAudioLevels) {
        return;
    }

    for (const indicator of state.remoteAudioIndicators.values()) {
        indicator.container.remove();
    }
    state.remoteAudioIndicators.clear();
    ensureRemoteAudioLevelsVisible();
}

function readTelemetryEvents() {
    if (!telemetryConfig.enabled || typeof window === 'undefined' || !window.localStorage) {
        return [];
    }
    try {
        const raw = window.localStorage.getItem(TELEMETRY_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed;
        }
    } catch (err) {
        console.warn('Failed to parse telemetry history', err);
    }
    return [];
}

function writeTelemetryEvents(events) {
    if (!telemetryConfig.enabled || typeof window === 'undefined' || !window.localStorage) {
        return;
    }
    try {
        window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(events));
    } catch (err) {
        console.warn('Failed to persist telemetry history', err);
    }
}

function logTelemetryEvent(type, details = {}) {
    if (!telemetryConfig.enabled) {
        return;
    }

    const events = readTelemetryEvents();
    events.push({
        type,
        timestamp: new Date().toISOString(),
        details,
    });

    if (events.length > MAX_TELEMETRY_EVENTS) {
        events.splice(0, events.length - MAX_TELEMETRY_EVENTS);
    }

    writeTelemetryEvents(events);
}

function registerLocalAudioLevel(localTracks) {
    const audioTrack = localTracks.find(track => track.getType() === 'audio');
    if (!audioTrack) {
        updateLocalAudioLevel(0);
        return;
    }

    audioTrack.on(
        JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED,
        level => updateLocalAudioLevel(level));
}

function registerRemoteAudioLevel(track) {
    if (!telemetryConfig.enableRemoteAudioLevels || track.isLocal() || track.getType() !== 'audio') {
        return;
    }

    createRemoteAudioIndicator(track);
    track.on(
        JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED,
        level => updateRemoteAudioIndicator(track.getId(), level));
}

function handleRecorderStateChanged(event) {
    const recordingStatus = (JitsiMeetJS.constants
        && JitsiMeetJS.constants.recording
        && JitsiMeetJS.constants.recording.status) || {};

    const status = event && event.status;
    switch (status) {
    case recordingStatus.ON:
        state.isRecording = true;
        setRecordingStatus('recording');
        logTelemetryEvent('recording-start', { mode: event && event.mode });
        break;
    case recordingStatus.PENDING:
        setRecordingStatus('pending');
        break;
    case recordingStatus.OFF:
        if (state.isRecording) {
            logTelemetryEvent('recording-stop', { reason: event && event.reason });
        }
        state.isRecording = false;
        setRecordingStatus('stopped');
        break;
    case recordingStatus.FAILED:
    case recordingStatus.ERROR:
        state.isRecording = false;
        setRecordingStatus('error', event && event.error ? String(event.error) : 'Recording failed');
        logTelemetryEvent('recording-error', { error: event && event.error });
        break;
    default:
        if (!state.isRecording) {
            setRecordingStatus('idle');
        }
    }
}

function cleanupConference(reason) {
    clearRemoteAudioIndicators();
    updateLocalAudioLevel(0);
    if (state.isRecording) {
        state.isRecording = false;
        setRecordingStatus('stopped', 'Recording ended');
    } else if (state.recordingStatus !== 'error') {
        setRecordingStatus('idle');
    }
    let message = '';
    switch (reason) {
    case 'leave':
        message = 'Left the conference';
        break;
    case 'conference-left':
        message = 'Conference ended';
        break;
    case 'idle':
        message = '';
        break;
    default:
        message = '';
    }
    setConnectionStatus('disconnected', message);
    if (state.sessionActive) {
        state.sessionActive = false;
        logTelemetryEvent('session-stop', { reason });
    }
    state.conference = undefined;
    updateJoinForm();
}

function updateJoinForm() {
    const isConnecting = state.connectionStatus === 'connecting';

    if (state.conference) {
        appIdEl.disabled = true;
        roomEl.disabled = true;
        jwtEl.disabled = true;
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
    } else {
        appIdEl.disabled = isConnecting;
        roomEl.disabled = isConnecting;
        jwtEl.disabled = isConnecting;
        joinBtn.disabled = isConnecting
            || state.appId.length === 0
            || state.room.length === 0
            || state.jwt.length === 0;
        leaveBtn.disabled = true;
    }
}

updateJoinForm();
updateConnectionBanner();
updateRecordingBanner();
updateLocalAudioLevel(0);
ensureRemoteAudioLevelsVisible();

window.addEventListener('beforeunload', event => {
    if (state.isRecording) {
        event.preventDefault();
        event.returnValue = recordingUnloadMessage;
        return recordingUnloadMessage;
    }
    return undefined;
});

appIdEl.onchange = () => {
    state.appId = appIdEl.value.trim();
    updateJoinForm();
};

roomEl.onchange = () => {
    state.room = roomEl.value.trim();
    updateJoinForm();
};

jwtEl.onchange = () => {
    state.jwt = jwtEl.value.trim();
    updateJoinForm();
};

joinBtn.onclick = async () => {
    try {
        await connect();
    } catch (err) {
        console.error('Failed to connect', err);
    } finally {
        updateJoinForm();
    }
};

leaveBtn.onclick = async () => {
    try {
        await leave();
    } catch (err) {
        console.error('Failed to leave conference', err);
    } finally {
        updateJoinForm();
    }
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
    } else if (!track.isLocal() && track.getType() === 'audio') {
        const audioNode = document.createElement('audio');

        audioNode.id = track.getId();
        audioNode.className = 'jitsiTrack';
        audioNode.autoplay = true;
        document.body.appendChild(audioNode);
        track.attach(audioNode);
        registerRemoteAudioLevel(track);
    }
};

const handleTrackRemoved = track => {
    track.dispose();
    document.getElementById(track.getId())?.remove();
    removeRemoteAudioIndicator(track.getId());
};

const onConferenceJoined = () => {
    console.log('conference joined!');
    state.sessionActive = true;
    setConnectionStatus('connected');
    logTelemetryEvent('session-start', { room: state.room, appId: state.appId });
};

const onConferenceLeft = () => {
    console.log('conference left!');
    cleanupConference('conference-left');
};

const onUserJoined = id => {
    console.log('user joined!', id);
};

const onUserLeft = id => {
    console.log('user left!', id);
};

async function connect() {
    if (state.connectionStatus === 'connecting') {
        return;
    }

    setConnectionStatus('connecting');
    updateJoinForm();

    try {
        const localTracks = await JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] });
        registerLocalAudioLevel(localTracks);

        const joinOptions = {
            tracks: localTracks,
        };
        const conference = await JitsiMeetJS.joinConference(state.room, state.appId, state.jwt, joinOptions);

        conference.on(
            JitsiMeetJS.events.conference.TRACK_ADDED,
            handleTrackAdded);
        conference.on(
            JitsiMeetJS.events.conference.TRACK_REMOVED,
            handleTrackRemoved);
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
        conference.on(
            JitsiMeetJS.events.conference.RECORDER_STATE_CHANGED,
            handleRecorderStateChanged);

        state.conference = conference;
    } catch (err) {
        console.error('Failed to join conference', err);
        state.sessionActive = false;
        state.conference = undefined;
        state.isRecording = false;
        clearRemoteAudioIndicators();
        updateLocalAudioLevel(0);
        setRecordingStatus('idle');
        setConnectionStatus('error', err && err.message ? String(err.message) : 'Unable to connect');
        logTelemetryEvent('session-error', {
            message: err && err.message ? String(err.message) : 'Unknown error',
        });
        throw err;
    }
}

// Leave the room and proceed to cleanup.
async function leave() {
    if (!state.conference) {
        cleanupConference('idle');
        return;
    }

    try {
        await state.conference.dispose();
    } finally {
        cleanupConference('leave');
    }
}

// Initialize library.
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);
