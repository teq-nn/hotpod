// Application state that reflects the UI and Jitsi session lifecycle.
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
    sessionActive: false,
    localAudioLevel: 0,
    localTracks: [],
    localAudioMonitor: null,
    remoteAudioIndicators: new Map(),
};

const envConfig = window.__HOT_POD_ENV__ || {};

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) {
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

function parseInteger(value, defaultValue) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return defaultValue;
    }
    return parsed;
}

const config = {
    telemetry: {
        enabled: parseBoolean(envConfig.HOT_POD_TELEMETRY_ENABLED, false),
        storageKey: envConfig.HOT_POD_TELEMETRY_STORAGE_KEY || 'hotpod:telemetry',
        maxEvents: parseInteger(envConfig.HOT_POD_TELEMETRY_MAX_EVENTS, 200) || 200,
    },
    remoteLevelsEnabled: parseBoolean(envConfig.HOT_POD_REMOTE_LEVELS_ENABLED, false),
    recordingUnloadMessage: envConfig.HOT_POD_RECORDING_UNLOAD_MESSAGE
        || 'A recording is currently in progress. Leaving may result in data loss.',
    defaults: {
        appId: envConfig.HOT_POD_DEFAULT_APP_ID || '',
        room: envConfig.HOT_POD_DEFAULT_ROOM || '',
        jwt: envConfig.HOT_POD_DEFAULT_JWT || '',
    },
};

function createTelemetry({ enabled, storageKey, maxEvents }) {
    if (!enabled) {
        return {
            log: () => {},
            read: () => [],
        };
    }

    const key = storageKey || 'hotpod:telemetry';
    const limit = Number.isFinite(maxEvents) && maxEvents > 0 ? maxEvents : 200;

    const storageAvailable = (() => {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return false;
            }
            const probeKey = '__hotpod_probe__';
            window.localStorage.setItem(probeKey, '1');
            window.localStorage.removeItem(probeKey);
            return true;
        } catch (error) {
            console.warn('Telemetry storage unavailable', error);
            return false;
        }
    })();

    let events = [];

    if (storageAvailable) {
        try {
            const raw = window.localStorage.getItem(key);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    events = parsed;
                }
            }
        } catch (error) {
            console.warn('Failed to read telemetry history', error);
        }
    }

    function persist() {
        if (!storageAvailable) {
            return;
        }

        try {
            window.localStorage.setItem(key, JSON.stringify(events));
        } catch (error) {
            console.warn('Failed to persist telemetry history', error);
        }
    }

    return {
        log(type, details = {}) {
            if (!type) {
                return;
            }

            events.push({
                type,
                timestamp: new Date().toISOString(),
                details,
            });

            if (events.length > limit) {
                events = events.slice(-limit);
            }

            persist();
        },
        read() {
            return events.slice();
        },
    };
}

const telemetry = createTelemetry(config.telemetry);

// Form elements.
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

function applyDefaultValue(element, fallback) {
    if (!element) {
        return '';
    }

    if (!element.value && fallback) {
        element.value = fallback;
    }

    return element.value.trim();
}

state.appId = applyDefaultValue(appIdEl, config.defaults.appId);
state.room = applyDefaultValue(roomEl, config.defaults.room);
state.jwt = applyDefaultValue(jwtEl, config.defaults.jwt);

if (!config.remoteLevelsEnabled && remoteAudioLevelsSection) {
    remoteAudioLevelsSection.remove();
}

function clampPercent(value) {
    if (Number.isNaN(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, value));
}

function percentFromLevel(level) {
    const safeLevel = Math.max(0, Math.min(1, Number(level) || 0));
    return clampPercent(Math.round(safeLevel * 100));
}

function formatStatus(baseText, message) {
    if (message) {
        return `${baseText} — ${message}`;
    }

    return baseText;
}

function updateJoinForm() {
    if (!appIdEl || !roomEl || !jwtEl || !joinBtn || !leaveBtn) {
        return;
    }

    const isConnecting = state.connectionStatus === 'connecting';
    const inConference = Boolean(state.conference);

    appIdEl.disabled = inConference || isConnecting;
    roomEl.disabled = inConference || isConnecting;
    jwtEl.disabled = inConference || isConnecting;

    const formIncomplete = !state.appId || !state.room || !state.jwt;
    joinBtn.disabled = inConference || isConnecting || formIncomplete;
    leaveBtn.disabled = !inConference;
}

function setConnectionStatus(status, message = '') {
    state.connectionStatus = status;
    state.connectionMessage = message;
    updateConnectionBanner();
    updateJoinForm();
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
    if (!remoteAudioLevelsSection) {
        return;
    }

    if (!config.remoteLevelsEnabled) {
        remoteAudioLevelsSection.hidden = true;
        return;
    }

    remoteAudioLevelsSection.hidden = state.remoteAudioIndicators.size === 0;
}

function createRemoteAudioIndicator(track) {
    if (!remoteAudioLevelGrid) {
        return null;
    }

    const trackId = track.getId();
    const participantId = track.getParticipantId();

    const column = document.createElement('div');
    column.className = 'col-12 col-md-6';
    column.dataset.trackId = trackId;

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
    column.appendChild(wrapper);

    remoteAudioLevelGrid.appendChild(column);

    return { container: column, bar };
}

function monitorAudioTrack(track, callback) {
    const handler = level => callback(level);

    track.on(
        JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED,
        handler,
    );

    return () => {
        if (typeof track.off === 'function') {
            track.off(JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED, handler);
        } else if (typeof track.removeEventListener === 'function') {
            track.removeEventListener(JitsiMeetJS.events.track.TRACK_AUDIO_LEVEL_CHANGED, handler);
        }
    };
}

function registerLocalAudioLevel(localTracks) {
    if (state.localAudioMonitor) {
        state.localAudioMonitor();
        state.localAudioMonitor = null;
    }

    const audioTrack = localTracks.find(track => track.getType() === 'audio');
    if (!audioTrack) {
        updateLocalAudioLevel(0);
        return;
    }

    updateLocalAudioLevel(0);
    state.localAudioMonitor = monitorAudioTrack(audioTrack, updateLocalAudioLevel);
}

function registerRemoteAudioLevel(track) {
    if (!config.remoteLevelsEnabled || track.isLocal() || track.getType() !== 'audio') {
        return;
    }

    const trackId = track.getId();
    if (state.remoteAudioIndicators.has(trackId)) {
        return;
    }

    const indicator = createRemoteAudioIndicator(track);
    if (!indicator) {
        return;
    }

    const unsubscribe = monitorAudioTrack(track, level => updateRemoteAudioIndicator(trackId, level));
    state.remoteAudioIndicators.set(trackId, { indicator, unsubscribe });
    ensureRemoteAudioLevelsVisible();
}

function updateRemoteAudioIndicator(trackId, level) {
    if (!config.remoteLevelsEnabled) {
        return;
    }

    const entry = state.remoteAudioIndicators.get(trackId);
    if (!entry) {
        return;
    }

    const percent = percentFromLevel(level);
    entry.indicator.bar.style.width = `${percent}%`;
    entry.indicator.bar.setAttribute('aria-valuenow', String(percent));
    entry.indicator.bar.textContent = percent >= 15 ? `${percent}%` : '';
}

function removeRemoteAudioIndicator(trackId) {
    if (!config.remoteLevelsEnabled) {
        return;
    }

    const entry = state.remoteAudioIndicators.get(trackId);
    if (!entry) {
        return;
    }

    try {
        entry.unsubscribe?.();
    } catch (error) {
        console.warn('Failed to detach remote audio monitor', error);
    }

    entry.indicator.container.remove();
    state.remoteAudioIndicators.delete(trackId);
    ensureRemoteAudioLevelsVisible();
}

function clearRemoteAudioIndicators() {
    if (!config.remoteLevelsEnabled) {
        return;
    }

    for (const trackId of Array.from(state.remoteAudioIndicators.keys())) {
        removeRemoteAudioIndicator(trackId);
    }
}

async function disposeTracks(tracks) {
    const work = tracks
        .map(track => (typeof track.dispose === 'function' ? track.dispose() : undefined))
        .filter(Boolean);

    if (work.length === 0) {
        return;
    }

    await Promise.allSettled(work);
}

async function cleanupConference(reason, { status, message } = {}) {
    const existingTracks = state.localTracks;
    state.localTracks = [];

    if (existingTracks.length) {
        await disposeTracks(existingTracks);
    }

    if (state.localAudioMonitor) {
        state.localAudioMonitor();
        state.localAudioMonitor = null;
    }

    updateLocalAudioLevel(0);
    clearRemoteAudioIndicators();

    if (state.isRecording) {
        state.isRecording = false;
        setRecordingStatus('stopped', reason === 'error' ? 'Recording interrupted' : 'Recording ended');
    } else if (state.recordingStatus !== 'error') {
        setRecordingStatus('idle');
    }

    const reasonMessages = {
        leave: 'Left the conference',
        'conference-left': 'Conference ended',
        idle: '',
        error: 'Conference ended unexpectedly',
    };

    const resolvedStatus = status || (reason === 'error' ? 'error' : 'disconnected');
    const resolvedMessage = message !== undefined ? message : (reasonMessages[reason] || '');

    if (state.sessionActive) {
        telemetry.log('session-stop', { reason });
    }
    state.sessionActive = false;

    state.conference = undefined;
    setConnectionStatus(resolvedStatus, resolvedMessage);
}

function handleRecorderStateChanged(event = {}) {
    const recordingStatus = JitsiMeetJS.constants?.recording?.status || {};
    const status = event.status;

    switch (status) {
    case recordingStatus.ON:
        state.isRecording = true;
        setRecordingStatus('recording');
        telemetry.log('recording-start', { mode: event.mode });
        break;
    case recordingStatus.PENDING:
        setRecordingStatus('pending');
        break;
    case recordingStatus.OFF:
        if (state.isRecording) {
            telemetry.log('recording-stop', { reason: event.reason });
        }
        state.isRecording = false;
        setRecordingStatus('stopped');
        break;
    case recordingStatus.FAILED:
    case recordingStatus.ERROR:
        state.isRecording = false;
        setRecordingStatus('error', event.error ? String(event.error) : 'Recording failed');
        telemetry.log('recording-error', { error: event.error });
        break;
    default:
        if (!state.isRecording) {
            setRecordingStatus('idle');
        }
    }
}

function handleTrackAdded(track) {
    if (track.getType() === 'video') {
        const meetingGrid = document.getElementById('meeting-grid');
        const videoNode = document.createElement('video');

        videoNode.id = track.getId();
        videoNode.className = 'jitsiTrack col-4 p-1';
        videoNode.autoplay = true;
        videoNode.playsInline = true;
        meetingGrid.appendChild(videoNode);
        track.attach(videoNode);
    } else if (track.getType() === 'audio' && !track.isLocal()) {
        const audioNode = document.createElement('audio');

        audioNode.id = track.getId();
        audioNode.className = 'jitsiTrack';
        audioNode.autoplay = true;
        document.body.appendChild(audioNode);
        track.attach(audioNode);
        registerRemoteAudioLevel(track);
    } else if (track.isLocal() && track.getType() === 'audio') {
        // Local audio replacement (for example when unmuting) should refresh the monitor.
        const existingIndex = state.localTracks.findIndex(t => t.getId() === track.getId());
        if (existingIndex === -1) {
            state.localTracks.push(track);
        } else {
            state.localTracks[existingIndex] = track;
        }
        registerLocalAudioLevel(state.localTracks);
    }
}

function handleTrackRemoved(track) {
    const element = document.getElementById(track.getId());
    if (element) {
        try {
            track.detach(element);
        } catch (error) {
            console.warn('Failed to detach track element', error);
        }
        element.remove();
    }

    removeRemoteAudioIndicator(track.getId());

    if (track.isLocal()) {
        state.localTracks = state.localTracks.filter(localTrack => localTrack.getId() !== track.getId());
        if (track.getType() === 'audio') {
            updateLocalAudioLevel(0);
            if (state.localAudioMonitor) {
                state.localAudioMonitor();
                state.localAudioMonitor = null;
            }
        }
    }

    try {
        track.dispose();
    } catch (error) {
        console.warn('Failed to dispose track', error);
    }
}

const onConferenceJoined = () => {
    console.log('conference joined!');
    state.sessionActive = true;
    setConnectionStatus('connected');
    telemetry.log('session-start', { room: state.room, appId: state.appId });
};

const onConferenceLeft = () => {
    console.log('conference left!');
    cleanupConference('conference-left').catch(error => {
        console.error('Conference cleanup failed', error);
    });
};

const onUserJoined = id => {
    console.log('user joined!', id);
};

const onUserLeft = id => {
    console.log('user left!', id);
};

async function connect() {
    if (state.connectionStatus === 'connecting' || state.conference) {
        return;
    }

    setConnectionStatus('connecting');

    let localTracks = [];

    try {
        localTracks = await JitsiMeetJS.createLocalTracks({ devices: [ 'audio', 'video' ] });
        state.localTracks = localTracks;
        registerLocalAudioLevel(localTracks);

        const joinOptions = { tracks: localTracks };
        const conference = await JitsiMeetJS.joinConference(state.room, state.appId, state.jwt, joinOptions);

        conference.on(
            JitsiMeetJS.events.conference.TRACK_ADDED,
            handleTrackAdded,
        );
        conference.on(
            JitsiMeetJS.events.conference.TRACK_REMOVED,
            handleTrackRemoved,
        );
        conference.on(
            JitsiMeetJS.events.conference.CONFERENCE_JOINED,
            onConferenceJoined,
        );
        conference.on(
            JitsiMeetJS.events.conference.CONFERENCE_LEFT,
            onConferenceLeft,
        );
        conference.on(
            JitsiMeetJS.events.conference.USER_JOINED,
            onUserJoined,
        );
        conference.on(
            JitsiMeetJS.events.conference.USER_LEFT,
            onUserLeft,
        );
        conference.on(
            JitsiMeetJS.events.conference.RECORDER_STATE_CHANGED,
            handleRecorderStateChanged,
        );

        state.conference = conference;
    } catch (error) {
        console.error('Failed to join conference', error);
        telemetry.log('session-error', {
            message: error?.message ? String(error.message) : 'Unknown error',
        });

        await disposeTracks(localTracks);
        state.localTracks = [];
        if (state.localAudioMonitor) {
            state.localAudioMonitor();
            state.localAudioMonitor = null;
        }
        updateLocalAudioLevel(0);
        clearRemoteAudioIndicators();
        setRecordingStatus('idle');
        setConnectionStatus('error', error?.message ? String(error.message) : 'Unable to connect');
        throw error;
    }
}

async function leave() {
    if (!state.conference) {
        await cleanupConference('idle');
        return;
    }

    try {
        if (typeof state.conference.leave === 'function') {
            await state.conference.leave();
        }
    } catch (error) {
        console.warn('Failed to leave conference gracefully', error);
    }

    try {
        await state.conference.dispose();
    } finally {
        await cleanupConference('leave');
    }
}

function handleBeforeUnload(event) {
    if (!state.isRecording) {
        return undefined;
    }

    event.preventDefault();
    event.returnValue = config.recordingUnloadMessage;
    return config.recordingUnloadMessage;
}

function bindFormEvents() {
    if (appIdEl) {
        appIdEl.addEventListener('input', () => {
            state.appId = appIdEl.value.trim();
            updateJoinForm();
        });
    }

    if (roomEl) {
        roomEl.addEventListener('input', () => {
            state.room = roomEl.value.trim();
            updateJoinForm();
        });
    }

    if (jwtEl) {
        jwtEl.addEventListener('input', () => {
            state.jwt = jwtEl.value.trim();
            updateJoinForm();
        });
    }

    if (joinBtn) {
        joinBtn.addEventListener('click', async event => {
            event.preventDefault();
            if (joinBtn.disabled) {
                return;
            }

            try {
                await connect();
            } catch (error) {
                console.error('Failed to connect', error);
            }
        });
    }

    if (leaveBtn) {
        leaveBtn.addEventListener('click', async event => {
            event.preventDefault();
            if (leaveBtn.disabled) {
                return;
            }

            try {
                await leave();
            } catch (error) {
                console.error('Failed to leave conference', error);
            }
        });
    }
}

function initialize() {
    updateJoinForm();
    updateConnectionBanner();
    updateRecordingBanner();
    updateLocalAudioLevel(0);
    ensureRemoteAudioLevelsVisible();
    bindFormEvents();
    window.addEventListener('beforeunload', handleBeforeUnload);
}

initialize();

// Initialize library.
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);
