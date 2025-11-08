import { getConfig } from './app/config.js';
import { parseQueryParams, formatDuration, isSafari } from './app/utils/helpers.js';
import { TelemetryBuffer } from './app/utils/telemetry.js';
import { SessionController, SessionEvents } from './app/session/session-controller.js';
import { RecordingManager, RecordingEvents } from './app/recording/recording-manager.js';

const config = getConfig();
const query = parseQueryParams();
const telemetry = new TelemetryBuffer(config.telemetry.enabled);
const appRoot = document.getElementById('app');
const inviteBaseEl = document.getElementById('inviteBase');

if (telemetry.enabled) {
    telemetry.addEventListener('telemetry:update', () => refreshTelemetry());
}

const inviteBase = `${window.location.origin}${window.location.pathname}?room=<roomId>&host=1`;
inviteBaseEl.textContent = inviteBase;

function buildInitialState() {
    return {
        phase: 'setup',
        room: query.room || '',
        isHost: query.host,
        appId: query.appId || config.defaultAppId || '',
        jwt: query.jwt || config.defaultJwt || '',
        devices: [],
        selectedDeviceId: '',
        consentAccepted: false,
        safariBlocked: isSafari(),
        errorMessage: '',
        session: null,
        recordingManager: null,
        recordingState: 'idle',
        trackSummaries: new Map(),
        sidecar: null,
        telemetry,
        lastCommandTs: null
    };
}

const state = buildInitialState();

let micMonitor;
let beforeUnloadHandler;

function ensureMicMonitor() {
    if (micMonitor) {
        return micMonitor;
    }

    micMonitor = {
        stream: null,
        audioContext: null,
        analyser: null,
        rafId: null,
        async start(deviceId, onLevel) {
            await this.stop();
            const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);

            const dataArray = new Uint8Array(this.analyser.fftSize);
            const update = () => {
                if (!this.analyser) {
                    return;
                }
                this.analyser.getByteTimeDomainData(dataArray);
                let peak = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const v = (dataArray[i] - 128) / 128;
                    peak = Math.max(peak, Math.abs(v));
                }
                onLevel(Math.min(1, peak));
                this.rafId = requestAnimationFrame(update);
            };

            update();
        },
        async stop() {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
                this.stream = null;
            }
            this.analyser = null;
        }
    };

    return micMonitor;
}

async function enumerateDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.devices = devices.filter(d => d.kind === 'audioinput');
        const currentDeviceExists = state.devices.some(device => device.deviceId === state.selectedDeviceId);
        if (!currentDeviceExists) {
            state.selectedDeviceId = '';
        }
        if (!state.selectedDeviceId && state.devices.length) {
            state.selectedDeviceId = state.devices[0].deviceId;
        }
    } catch (error) {
        console.warn('enumerateDevices failed', error);
        state.errorMessage = 'Unable to enumerate audio devices. Ensure microphone permissions are granted.';
    }
}

function render() {
    if (state.phase === 'setup') {
        renderSetup();
    } else {
        renderSession();
    }
}

function renderSetup() {
    appRoot.innerHTML = `
        <div class="row justify-content-center">
            <div class="col-lg-8">
                <div class="hotpod-card p-4">
                    <div class="d-flex justify-content-between align-items-start mb-3">
                        <div>
                            <h2 class="h4 mb-1">Prepare your session</h2>
                            <p class="text-secondary mb-0">Select your microphone, confirm consent, and join the Hotpod room.</p>
                        </div>
                        <span class="badge ${state.isHost ? 'badge-role-host' : 'badge-role-guest'}">${state.isHost ? 'Host' : 'Guest'}</span>
                    </div>
                    ${state.errorMessage ? `<div class="alert alert-warning">${state.errorMessage}</div>` : ''}
                    ${state.safariBlocked ? '<div class="alert alert-danger">Safari support is experimental. Expect degraded performance and prefer Chromium or Firefox for production sessions.</div>' : ''}
                    <form id="setupForm" class="d-flex flex-column gap-4">
                        <div class="row g-3">
                            <div class="col-md-6">
                                <label class="form-label text-secondary">Room</label>
                                <input type="text" class="form-control" id="roomInput" placeholder="studio-room" value="${state.room}">
                                <div class="form-text">Share the invite URL with <code>&host=1</code> for host privileges.</div>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label text-secondary">Microphone</label>
                                <select class="form-select" id="deviceSelect"></select>
                                <button class="btn btn-sm btn-outline-info mt-2" type="button" id="refreshDevices">Refresh devices</button>
                            </div>
                        </div>
                        <div class="row g-3">
                            <div class="col-md-6">
                                <label class="form-label text-secondary">JaaS App ID</label>
                                <input type="text" class="form-control" id="appIdInput" placeholder="vpaas-magic-cookie-1234" value="${state.appId}">
                            </div>
                            <div class="col-md-6">
                                <label class="form-label text-secondary">JWT</label>
                                <textarea class="form-control" id="jwtInput" rows="2" placeholder="Paste your JWT here">${state.jwt}</textarea>
                            </div>
                        </div>
                        <div>
                            <label class="form-label text-secondary">Microphone check</label>
                            <div class="level-meter" id="levelMeter"><span></span></div>
                            <div class="d-flex gap-2 mt-2">
                                <button class="btn btn-outline-light btn-sm" type="button" id="startPreview">Start preview</button>
                                <button class="btn btn-outline-light btn-sm" type="button" id="stopPreview">Stop preview</button>
                            </div>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" value="1" id="consentCheckbox" ${state.consentAccepted ? 'checked' : ''}>
                            <label class="form-check-label" for="consentCheckbox">
                                I have informed all participants that the session will be locally recorded on every device.
                            </label>
                        </div>
                        <div class="d-flex justify-content-between align-items-center flex-column flex-md-row gap-3">
                            <div class="text-secondary small">
                                Joining as <strong>${state.isHost ? 'host' : 'guest'}</strong>. Hosts can trigger recording for all participants.
                            </div>
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-outline-secondary" id="resetForm">Reset</button>
                                <button type="submit" class="btn btn-primary" id="joinButton" ${shouldDisableJoin() ? 'disabled' : ''}>Join session</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    populateDeviceSelect();

    document.getElementById('roomInput').addEventListener('input', event => {
        state.room = event.target.value.trim();
        updateJoinDisabled();
    });
    document.getElementById('appIdInput').addEventListener('input', event => {
        state.appId = event.target.value.trim();
        updateJoinDisabled();
    });
    document.getElementById('jwtInput').addEventListener('input', event => {
        state.jwt = event.target.value.trim();
        updateJoinDisabled();
    });
    document.getElementById('deviceSelect').addEventListener('change', event => {
        state.selectedDeviceId = event.target.value;
    });
    document.getElementById('consentCheckbox').addEventListener('change', event => {
        state.consentAccepted = event.target.checked;
        updateJoinDisabled();
    });
    document.getElementById('refreshDevices').addEventListener('click', async () => {
        await enumerateDevices();
        populateDeviceSelect();
    });
    document.getElementById('startPreview').addEventListener('click', async () => {
        try {
            await ensureMicMonitor().start(state.selectedDeviceId, level => updateLevelMeter(level));
        } catch (error) {
            state.errorMessage = 'Unable to access microphone for preview. Check permissions.';
            render();
        }
    });
    document.getElementById('stopPreview').addEventListener('click', async () => {
        await ensureMicMonitor().stop();
        updateLevelMeter(0);
    });
    document.getElementById('resetForm').addEventListener('click', () => {
        const next = buildInitialState();
        next.devices = state.devices;
        next.safariBlocked = state.safariBlocked;
        Object.assign(state, next);
        render();
    });
    document.getElementById('setupForm').addEventListener('submit', handleJoin);
}

function populateDeviceSelect() {
    const select = document.getElementById('deviceSelect');
    if (!select) {
        return;
    }

    if (!state.devices.length) {
        select.innerHTML = '<option value="">No microphones detected</option>';
        return;
    }

    select.innerHTML = state.devices.map(device => `
        <option value="${device.deviceId}" ${state.selectedDeviceId === device.deviceId ? 'selected' : ''}>${device.label || 'Microphone'}</option>
    `).join('');
}

function shouldDisableJoin() {
    const hasCredentials = state.appId.length > 0 && state.jwt.length > 0 && state.room.length > 0;
    return !hasCredentials || !state.consentAccepted;
}

function updateJoinDisabled() {
    const joinButton = document.getElementById('joinButton');
    if (joinButton) {
        joinButton.disabled = shouldDisableJoin();
    }
}

function updateLevelMeter(level) {
    const meter = document.querySelector('#levelMeter span');
    if (meter) {
        meter.style.width = `${Math.round(level * 100)}%`;
    }
}

async function handleJoin(event) {
    event.preventDefault();
    state.errorMessage = '';

    if (shouldDisableJoin()) {
        state.errorMessage = 'Please fill in all required fields, grant consent, and ensure your browser is supported.';
        render();
        return;
    }

    try {
        await ensureMicMonitor().stop();
        updateLevelMeter(0);
    } catch (error) {
        console.warn('Failed to stop mic monitor', error);
    }

    try {
        await enumerateDevices();
        const session = new SessionController({
            domain: config.domain,
            appId: state.appId,
            room: state.room,
            jwt: state.jwt,
            isHost: state.isHost,
            telemetry
        });
        const recordingManager = new RecordingManager({ room: state.room, telemetry, domain: config.domain });
        attachSessionListeners(session, recordingManager);
        await session.join({ audioDeviceId: state.selectedDeviceId });
        telemetry.push('session:joined', { room: state.room, host: state.isHost, domain: config.domain });
        state.session = session;
        state.recordingManager = recordingManager;
        state.phase = 'session';
        state.trackSummaries = new Map();
        state.sidecar = null;
        state.recordingState = 'idle';
        render();
    } catch (error) {
        console.error('Join failed', error);
        state.errorMessage = `Unable to join session: ${error.message}`;
        render();
    }
}

function attachSessionListeners(session, recordingManager) {
    session.addEventListener(SessionEvents.TRACK_ADDED, event => {
        recordingManager.registerTrack(event.detail);
    });
    session.addEventListener(SessionEvents.TRACK_REMOVED, event => {
        recordingManager.unregisterTrack(event.detail.trackId);
        if (objectUrlCache.has(event.detail.trackId)) {
            URL.revokeObjectURL(objectUrlCache.get(event.detail.trackId));
            objectUrlCache.delete(event.detail.trackId);
        }
        state.trackSummaries.delete(event.detail.trackId);
        refreshTrackList();
    });
    session.addEventListener(SessionEvents.RECORDING_COMMAND, event => {
        handleRecordingCommand(recordingManager, event.detail);
    });
    session.addEventListener(SessionEvents.CONFERENCE_LEFT, () => {
        telemetry.push('session:left');
        teardownSession();
    });

    recordingManager.addEventListener(RecordingEvents.STATE_CHANGED, event => {
        state.recordingState = event.detail.state;
        state.lastCommandTs = event.detail.state === 'recording' ? event.detail.startTs : event.detail.stopTs;
        updateBeforeUnloadGuard();
        refreshRecordingBanner();
        refreshTelemetry();
    });
    recordingManager.addEventListener(RecordingEvents.TRACK_UPDATED, event => {
        const previous = state.trackSummaries.get(event.detail.id);
        if (previous?.blob && previous.blob !== event.detail.blob && objectUrlCache.has(event.detail.id)) {
            URL.revokeObjectURL(objectUrlCache.get(event.detail.id));
            objectUrlCache.delete(event.detail.id);
        }
        const summary = {
            id: event.detail.id,
            participantId: event.detail.participantId,
            displayName: event.detail.displayName,
            isLocal: event.detail.isLocal,
            state: event.detail.state,
            metadata: event.detail.metadata,
            fileName: event.detail.fileName,
            blob: event.detail.blob
        };
        state.trackSummaries.set(summary.id, summary);
        refreshTrackList();
    });
    recordingManager.addEventListener(RecordingEvents.EXPORT_READY, event => {
        telemetry.push('recording:export-ready', { trackId: event.detail.id });
    });
    recordingManager.addEventListener(RecordingEvents.SIDECAR_READY, event => {
        state.sidecar = {
            fileName: event.detail.fileName,
            blob: event.detail.blob,
            payload: event.detail.payload
        };
        telemetry.push('recording:sidecar-ready', { fileName: state.sidecar.fileName });
        refreshSidecar();
    });
}

function handleRecordingCommand(recordingManager, command) {
    if (!command?.type) {
        return;
    }

    switch (command.type) {
    case 'REC_START':
        recordingManager.startRecording(typeof command.ts === 'number' ? command.ts : Date.now());
        break;
    case 'REC_STOP':
        recordingManager.stopRecording(typeof command.ts === 'number' ? command.ts : Date.now());
        break;
    default:
        console.warn('Unknown recording command', command.type);
    }
}

function renderSession() {
    const recordingState = state.recordingState;
    const recordingLabel = getRecordingLabel(recordingState);
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.room)}`;
    const hostLink = `${roomLink}&host=1`;
    const guestLink = roomLink;

    appRoot.innerHTML = `
        <div class="row g-4">
            <div class="col-lg-8">
                <div class="hotpod-card p-4 h-100 d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-start mb-3">
                        <div>
                            <h2 class="h4 mb-1">Recording control</h2>
                            <p class="text-secondary mb-0">${state.isHost ? 'Trigger capture for everyone in the room.' : 'Wait for the host to start recording.'}</p>
                        </div>
                        <span class="badge ${state.isHost ? 'badge-role-host' : 'badge-role-guest'}">${state.isHost ? 'Host' : 'Guest'}</span>
                    </div>
                    ${state.errorMessage ? `<div class="alert alert-warning">${state.errorMessage}</div>` : ''}
                    <div class="recording-banner ${recordingState === 'recording' ? 'recording' : ''} mb-3" id="recordingBanner">
                        <strong>${recordingLabel}</strong>
                        <div class="small text-secondary" id="recordingMeta"></div>
                    </div>
                    <div class="d-flex gap-2 mb-3">
                        ${state.isHost ? renderHostControls() : '<div class="text-secondary">Awaiting host commands…</div>'}
                    </div>
                    <div class="flex-grow-1 overflow-auto" id="trackList"></div>
                    <div class="mt-3">
                        <button class="btn btn-outline-danger" id="leaveButton">Leave session</button>
                    </div>
                </div>
            </div>
            <div class="col-lg-4">
                <div class="hotpod-card p-4 mb-4">
                    <h3 class="h5">Invite participants</h3>
                    <p class="small text-secondary">Share these links with your collaborators.</p>
                    <div class="mb-2">
                        <div class="text-secondary small">Host link</div>
                        <code class="d-block text-break"><a class="hotpod-link" href="${hostLink}">${hostLink}</a></code>
                    </div>
                    <div>
                        <div class="text-secondary small">Guest link</div>
                        <code class="d-block text-break"><a class="hotpod-link" href="${guestLink}">${guestLink}</a></code>
                    </div>
                </div>
                <div class="hotpod-card p-4" id="sidecarPanel">
                    <h3 class="h5">Exports</h3>
                    <p class="small text-secondary">Download stems after the host stops recording.</p>
                    <div id="sidecarContent" class="small text-secondary">No exports yet.</div>
                </div>
                ${telemetry.enabled ? `
                    <div class="hotpod-card p-4 mt-4">
                        <h3 class="h5">Telemetry</h3>
                        <div class="table-responsive">
                            <table class="table table-dark table-sm table-striped align-middle telemetry-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Timestamp</th>
                                        <th>Type</th>
                                        <th>Payload</th>
                                    </tr>
                                </thead>
                                <tbody id="telemetryBody"></tbody>
                            </table>
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    document.getElementById('leaveButton').addEventListener('click', leaveSession);
    if (state.isHost) {
        document.getElementById('startRecording').addEventListener('click', () => sendRecordingCommand('REC_START'));
        document.getElementById('stopRecording').addEventListener('click', () => sendRecordingCommand('REC_STOP'));
    }
    refreshTrackList();
    refreshRecordingBanner();
    refreshSidecar();
    refreshTelemetry();
}

function renderHostControls() {
    const disabledStart = state.recordingState === 'recording' || state.recordingState === 'stopping';
    const disabledStop = state.recordingState !== 'recording';
    return `
        <button class="btn btn-primary" id="startRecording" ${disabledStart ? 'disabled' : ''}>Start recording</button>
        <button class="btn btn-outline-light" id="stopRecording" ${disabledStop ? 'disabled' : ''}>Stop recording</button>
    `;
}

function refreshRecordingBanner() {
    if (state.phase !== 'session') {
        return;
    }
    const banner = document.getElementById('recordingBanner');
    const meta = document.getElementById('recordingMeta');
    if (!banner || !meta) {
        return;
    }
    const label = getRecordingLabel(state.recordingState);
    banner.querySelector('strong').textContent = label;
    if (state.recordingState === 'recording' && state.lastCommandTs) {
        meta.textContent = `Started at ${new Date(state.lastCommandTs).toLocaleTimeString()}`;
    } else if ((state.recordingState === 'stopping' || state.recordingState === 'exported') && state.lastCommandTs) {
        meta.textContent = `Stopped at ${new Date(state.lastCommandTs).toLocaleTimeString()}`;
    } else {
        meta.textContent = '';
    }
    if (state.recordingState === 'recording') {
        banner.classList.add('recording');
    } else {
        banner.classList.remove('recording');
    }
}

function refreshTrackList() {
    const trackList = document.getElementById('trackList');
    if (!trackList) {
        return;
    }

    if (!state.trackSummaries.size) {
        trackList.innerHTML = '<p class="text-secondary">Tracks will appear here once participants join.</p>';
        return;
    }

    const fragments = [];
    const sorted = Array.from(state.trackSummaries.values()).sort((a, b) => {
        return (a.displayName || '').localeCompare(b.displayName || '');
    });
    for (const summary of sorted) {
        const statusClass = `status-${summary.state}`;
        const badge = summary.isLocal ? 'badge-track-local' : 'badge-track-remote';
        const stateLabel = summary.state.charAt(0).toUpperCase() + summary.state.slice(1);
        const duration = summary.metadata?.durationMs ? formatDuration(summary.metadata.durationMs) : '--:--';
        const downloadButton = summary.blob ? `<a class="btn btn-sm btn-outline-info" href="${createObjectUrl(summary)}" download="${summary.fileName}">Download</a>` : '';
        fragments.push(`
            <div class="track-list-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5>${summary.displayName || 'Participant'} <span class="badge ${badge}">${summary.isLocal ? 'Local' : 'Remote'}</span></h5>
                        <div class="small text-secondary">${summary.participantId}</div>
                    </div>
                    <div class="text-end">
                        <span class="status-indicator ${statusClass}"></span>${stateLabel}
                    </div>
                </div>
                <div class="small text-secondary mt-2">
                    Duration: ${duration} · Chunks: ${summary.metadata?.sequence || 0}
                </div>
                ${downloadButton ? `<div class="mt-2">${downloadButton}</div>` : ''}
            </div>
        `);
    }

    trackList.innerHTML = fragments.join('');
}

const objectUrlCache = new Map();

function createObjectUrl(summary) {
    if (!summary.blob) {
        return '';
    }

    if (objectUrlCache.has(summary.id)) {
        return objectUrlCache.get(summary.id);
    }

    const url = URL.createObjectURL(summary.blob);
    objectUrlCache.set(summary.id, url);
    return url;
}

function refreshSidecar() {
    const panel = document.getElementById('sidecarContent');
    if (!panel) {
        return;
    }

    if (!state.sidecar) {
        panel.innerHTML = 'No exports yet.';
        return;
    }

    if (!objectUrlCache.has('sidecar')) {
        objectUrlCache.set('sidecar', URL.createObjectURL(state.sidecar.blob));
    }

    const url = objectUrlCache.get('sidecar');
    panel.innerHTML = `
        <div class="mb-2">Metadata JSON is ready.</div>
        <a class="btn btn-sm btn-outline-info" href="${url}" download="${state.sidecar.fileName}">Download metadata</a>
    `;
}

function refreshTelemetry() {
    if (!telemetry.enabled) {
        return;
    }
    const body = document.getElementById('telemetryBody');
    if (!body) {
        return;
    }
    body.innerHTML = telemetry.toTableRows();
}

function sendRecordingCommand(type) {
    if (!state.session) {
        return;
    }

    try {
        const ts = Date.now();
        state.session.broadcastRecordingCommand(type, ts);
        telemetry.push('recording:command', { type, ts });
    } catch (error) {
        state.errorMessage = error.message;
        refreshRecordingBanner();
        alert(`Unable to send command: ${error.message}`);
    }
}

async function leaveSession() {
    if (state.session) {
        try {
            await state.session.leave();
        } catch (error) {
            console.warn('Leave failed', error);
        }
    }

    teardownSession();
    const next = buildInitialState();
    next.devices = state.devices;
    next.safariBlocked = state.safariBlocked;
    Object.assign(state, next);
    state.phase = 'setup';
    render();
}

function teardownSession() {
    if (state.session) {
        state.session.destroy();
    }
    if (state.recordingManager) {
        state.recordingManager.reset();
    }
    if (micMonitor) {
        micMonitor.stop();
    }
    state.session = null;
    state.recordingManager = null;
    state.trackSummaries = new Map();
    state.sidecar = null;
    state.recordingState = 'idle';
    state.lastCommandTs = null;
    objectUrlCache.forEach(url => URL.revokeObjectURL(url));
    objectUrlCache.clear();
    updateBeforeUnloadGuard(true);
}

function updateBeforeUnloadGuard(forceRemove = false) {
    if (forceRemove || (state.recordingState !== 'recording' && state.recordingState !== 'stopping')) {
        if (beforeUnloadHandler) {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            beforeUnloadHandler = null;
        }
        return;
    }

    if (!beforeUnloadHandler) {
        beforeUnloadHandler = event => {
            event.preventDefault();
            event.returnValue = 'Recording is still in progress. Leaving will lose captured audio.';
            return event.returnValue;
        };
        window.addEventListener('beforeunload', beforeUnloadHandler);
    }
}

function getRecordingLabel(stateName) {
    switch (stateName) {
    case 'recording':
        return 'Recording in progress';
    case 'stopping':
        return 'Stopping – finalizing files';
    case 'exported':
        return 'Export ready';
    default:
        return 'Idle – waiting for host command';
    }
}

async function bootstrap() {
    try {
        await enumerateDevices();
    } catch (error) {
        console.warn('Initial enumerate failed', error);
    }

    if (navigator.mediaDevices) {
        const handleDeviceChange = async () => {
            await enumerateDevices();
            if (state.phase === 'setup') {
                populateDeviceSelect();
            }
        };

        if (navigator.mediaDevices.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        } else if ('ondevicechange' in navigator.mediaDevices) {
            navigator.mediaDevices.ondevicechange = handleDeviceChange;
        }
    }

    JitsiMeetJS.init();
    if (JitsiMeetJS.setLogLevel && JitsiMeetJS.logLevels) {
        JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
    }
    render();
}

bootstrap();
