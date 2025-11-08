// App global state.
//

const state = {
    appId: '',
    room: '',
    jwt: '',
    conference: undefined,
    isHost: false,
    hostId: undefined,
    localParticipantId: undefined,
    broadcast: {
        active: false,
        lastEventId: 0,
        log: [],
        pendingSync: false,
    },
};

// Form elements.
//

const appIdEl = document.getElementById('appIdText');
const roomEl = document.getElementById('roomText');
const jwtEl = document.getElementById('jwtText');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const hostControlsEl = document.getElementById('hostControls');
const startBroadcastBtn = document.getElementById('startBroadcastBtn');
const stopBroadcastBtn = document.getElementById('stopBroadcastBtn');
const broadcastStatusEl = document.getElementById('broadcastStatus');

function updateHostControls() {
    if (!hostControlsEl) {
        return;
    }

    const ready = Boolean(state.conference) && Boolean(state.localParticipantId);

    hostControlsEl.hidden = !ready;

    startBroadcastBtn.hidden = !state.isHost;
    stopBroadcastBtn.hidden = !state.isHost;

    startBroadcastBtn.disabled = !state.isHost || state.broadcast.active;
    stopBroadcastBtn.disabled = !state.isHost || !state.broadcast.active;

    updateBroadcastStatus();
}

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

    updateHostControls();
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

startBroadcastBtn.onclick = () => {
    if (!state.isHost) {
        return;
    }

    broadcastEvent('start');
};

stopBroadcastBtn.onclick = () => {
    if (!state.isHost) {
        return;
    }

    broadcastEvent('stop');
};

function resetBroadcastState() {
    state.broadcast.active = false;
    state.broadcast.lastEventId = 0;
    state.broadcast.log = [];
    state.broadcast.pendingSync = false;
    updateHostControls();
}

function ensureHostId(id) {
    if (!state.hostId) {
        state.hostId = id;
    }
}

function broadcastEvent(eventType) {
    if (!state.conference || !state.isHost) {
        return;
    }

    const eventId = state.broadcast.lastEventId + 1;
    const payload = {
        kind: 'broadcast-event',
        eventType,
        eventId,
        timestamp: Date.now(),
        hostId: state.hostId,
    };

    state.broadcast.lastEventId = eventId;
    state.broadcast.log.push(payload);
    state.broadcast.log = state.broadcast.log.slice(-50);

    processBroadcastEvent(payload);

    state.conference.getParticipants().forEach(p => {
        state.conference.sendEndpointMessage(p.getId(), payload);
    });
}

function processBroadcastEvent(event) {
    if (!state.isHost) {
        if (state.hostId && event.hostId !== state.hostId) {
            return;
        }

        ensureHostId(event.hostId);

        if (event.eventId <= state.broadcast.lastEventId) {
            return;
        }

        if (event.eventId > state.broadcast.lastEventId + 1) {
            requestBroadcastSync();
            return;
        }
    }

    state.broadcast.lastEventId = event.eventId;
    state.broadcast.active = event.eventType === 'start';
    updateHostControls();
}

function updateBroadcastStatus() {
    if (!broadcastStatusEl) {
        return;
    }

    if (!state.conference) {
        broadcastStatusEl.textContent = '';
        return;
    }

    broadcastStatusEl.textContent = state.broadcast.active ? 'Broadcast active' : 'Broadcast stopped';
}

function requestBroadcastSync() {
    if (!state.conference || state.broadcast.pendingSync || !state.hostId || state.isHost) {
        return;
    }

    state.broadcast.pendingSync = true;
    state.conference.sendEndpointMessage(state.hostId, {
        kind: 'broadcast-sync-request',
        lastEventId: state.broadcast.lastEventId,
    });

    setTimeout(() => {
        state.broadcast.pendingSync = false;
    }, 2000);
}

function sendHostAnnouncement(participantId) {
    if (!state.isHost || !state.hostId || !state.conference) {
        return;
    }

    state.conference.sendEndpointMessage(participantId, {
        kind: 'host-info',
        hostId: state.hostId,
    });

    const eventsToSend = state.broadcast.log;

    state.conference.sendEndpointMessage(participantId, {
        kind: 'broadcast-sync-response',
        hostId: state.hostId,
        events: eventsToSend,
    });
}

function handleEndpointMessage(participant, payload) {
    if (!payload || typeof payload !== 'object') {
        return;
    }

    switch (payload.kind) {
    case 'host-info':
        ensureHostId(payload.hostId);
        updateHostControls();
        break;
    case 'broadcast-event':
        if (participant.getId() !== payload.hostId) {
            return;
        }

        if (state.isHost && participant.getId() !== state.hostId) {
            return;
        }

        if (!state.isHost && state.hostId && participant.getId() !== state.hostId) {
            return;
        }

        ensureHostId(payload.hostId);
        processBroadcastEvent(payload);
        break;
    case 'broadcast-sync-request':
        if (state.isHost) {
            const lastEventId = payload.lastEventId || 0;
            const eventsToSend = state.broadcast.log.filter(event => event.eventId > lastEventId);

            state.conference.sendEndpointMessage(participant.getId(), {
                kind: 'broadcast-sync-response',
                hostId: state.hostId,
                events: eventsToSend,
            });
        }
        break;
    case 'broadcast-sync-response':
        if (!state.isHost && (!state.hostId || participant.getId() === state.hostId) && Array.isArray(payload.events)) {
            if (payload.hostId) {
                ensureHostId(payload.hostId);
            }

            if (state.hostId && participant.getId() !== state.hostId) {
                return;
            }

            payload.events
                .sort((a, b) => a.eventId - b.eventId)
                .forEach(processBroadcastEvent);

            state.broadcast.pendingSync = false;
        }
        break;
    default:
        break;
    }
}


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

    if (!state.conference) {
        return;
    }

    state.localParticipantId = state.conference.getMyUserId();
    state.isHost = state.conference.isModerator();

    if (state.isHost) {
        state.hostId = state.localParticipantId;
        state.broadcast.log = [];
        state.broadcast.pendingSync = false;
        updateHostControls();

        state.conference.getParticipants().forEach(participant => {
            sendHostAnnouncement(participant.getId());
        });
    } else {
        const remoteParticipants = state.conference.getParticipants();
        const moderator = remoteParticipants.find(participant => typeof participant.isModerator === 'function' && participant.isModerator());

        if (moderator) {
            state.hostId = moderator.getId();
            requestBroadcastSync();
        }

        updateHostControls();
    }
};

const onConferenceLeft = () => {
    console.log('conference left!');
    resetBroadcastState();
    state.conference = undefined;
    state.isHost = false;
    state.hostId = undefined;
    state.localParticipantId = undefined;
    updateHostControls();
};

const onUserJoined = id => {
    console.log('user joined!', id);

    if (state.isHost) {
        sendHostAnnouncement(id);
    } else if (!state.hostId && state.conference) {
        const participant = state.conference.getParticipantById?.(id);

        if (participant && typeof participant.isModerator === 'function' && participant.isModerator()) {
            state.hostId = participant.getId();
            requestBroadcastSync();
        }
    }
};

const onUserLeft = id => {
    console.log('user left!', id);

    if (!state.isHost && state.hostId === id) {
        state.hostId = undefined;
        resetBroadcastState();
    }
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
    c.on(
        JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED,
        handleEndpointMessage);

    state.conference = c;
    state.isHost = false;
    state.hostId = undefined;
    state.localParticipantId = undefined;
    resetBroadcastState();
}

// Leave the room and proceed to cleanup.
async function leave() {
    if (state.conference) {
        await state.conference.dispose();
    }

    state.conference = undefined;
    state.isHost = false;
    state.hostId = undefined;
    state.localParticipantId = undefined;
    resetBroadcastState();
}

// Initialize library.
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);
