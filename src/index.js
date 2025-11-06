// App global state.
//

const state = {
    appId: '',
    room: '',
    jwt: '',
    conference: undefined,
    consentGiven: false,
    selectedMicId: undefined,
    micDevices: [],
    micTest: {
        stream: undefined,
        audioContext: undefined,
        analyser: undefined,
        rafId: undefined,
    },
};

const storedConsent = sessionStorage.getItem('consentGiven');
if (storedConsent === 'true') {
    state.consentGiven = true;
}

const storedMicId = sessionStorage.getItem('selectedMicId');
if (storedMicId) {
    state.selectedMicId = storedMicId;
}

// Form elements.
//

const appIdEl = document.getElementById('appIdText');
const roomEl = document.getElementById('roomText');
const jwtEl = document.getElementById('jwtText');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const micSelectEl = document.getElementById('micSelect');
const micTestBtn = document.getElementById('micTestBtn');
const micLevelBar = document.getElementById('micLevelBar');
const micStatusText = document.getElementById('micStatusText');
const consentOverlay = document.getElementById('consentOverlay');
const consentCheckbox = document.getElementById('consentCheckbox');
const consentConfirmBtn = document.getElementById('consentConfirmBtn');

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
        const hasFormValues = state.appId.length > 0 && state.room.length > 0 && state.jwt.length > 0;
        joinBtn.disabled = !(state.consentGiven && hasFormValues);
        leaveBtn.disabled = true;
    }
}

function updateConsentUI() {
    if (!consentOverlay) {
        return;
    }

    consentOverlay.classList.toggle('d-none', state.consentGiven);
    if (state.consentGiven) {
        consentOverlay.setAttribute('aria-hidden', 'true');
    } else {
        consentOverlay.removeAttribute('aria-hidden');
    }
}

function persistMicSelection() {
    if (!state.consentGiven) {
        return;
    }

    if (state.selectedMicId) {
        sessionStorage.setItem('selectedMicId', state.selectedMicId);
    } else {
        sessionStorage.removeItem('selectedMicId');
    }
}

function getSelectedMicLabel() {
    if (!micSelectEl) {
        return '';
    }

    const option = micSelectEl.options[micSelectEl.selectedIndex];

    return option ? option.textContent : '';
}

function updateMicStatus(additionalMessage = '') {
    if (!micStatusText) {
        return;
    }

    const label = getSelectedMicLabel();
    const parts = [];

    if (label) {
        parts.push(`Ausgewählt: ${label}`);
    }

    if (additionalMessage) {
        parts.push(additionalMessage);
    }

    micStatusText.textContent = parts.join(' · ');
}

function resetMicTestState() {
    if (state.micTest.rafId) {
        cancelAnimationFrame(state.micTest.rafId);
        state.micTest.rafId = undefined;
    }

    if (state.micTest.stream) {
        state.micTest.stream.getTracks().forEach(track => track.stop());
        state.micTest.stream = undefined;
    }

    if (state.micTest.audioContext) {
        state.micTest.audioContext.close();
        state.micTest.audioContext = undefined;
    }

    state.micTest.analyser = undefined;
}

function stopMicTest(options = {}) {
    resetMicTestState();
    if (micLevelBar) {
        micLevelBar.style.width = '0%';
    }

    if (micTestBtn) {
        micTestBtn.textContent = 'Pegeltest starten';
    }

    if (!options.skipStatusUpdate) {
        updateMicStatus();
    }
}

function updateMicLevel() {
    if (!state.micTest.analyser) {
        return;
    }

    const analyser = state.micTest.analyser;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;

    for (let i = 0; i < bufferLength; i++) {
        const normalizedSample = (dataArray[i] - 128) / 128;

        sumSquares += normalizedSample * normalizedSample;
    }

    const rms = Math.sqrt(sumSquares / bufferLength);
    const level = Math.min(100, Math.round(rms * 200));

    if (micLevelBar) {
        micLevelBar.style.width = `${level}%`;
    }

    state.micTest.rafId = requestAnimationFrame(updateMicLevel);
}

async function startMicTest() {
    stopMicTest();

    if (!navigator.mediaDevices?.getUserMedia) {
        updateMicStatus('Pegeltest wird nicht unterstützt.');
        return;
    }

    const deviceId = state.selectedMicId;
    const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : undefined;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints ? audioConstraints : true,
        });

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

        if (!AudioContextCtor) {
            stream.getTracks().forEach(track => track.stop());
            updateMicStatus('Web Audio API nicht verfügbar.');
            return;
        }

        const audioContext = new AudioContextCtor();
        const analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);

        analyser.fftSize = 2048;
        source.connect(analyser);

        state.micTest.stream = stream;
        state.micTest.audioContext = audioContext;
        state.micTest.analyser = analyser;

        if (micTestBtn) {
            micTestBtn.textContent = 'Pegeltest stoppen';
        }

        updateMicStatus('Pegeltest aktiv. Sprechen Sie ins Mikrofon.');
        updateMicLevel();
    } catch (error) {
        stopMicTest({ skipStatusUpdate: true });
        updateMicStatus(`Pegeltest fehlgeschlagen: ${error.message}`);
    }
}

async function loadMicrophones() {
    if (!micSelectEl) {
        return;
    }

    micSelectEl.innerHTML = '<option value="">Lade Mikrofone…</option>';
    micSelectEl.disabled = true;
    updateMicStatus('Mikrofone werden geladen…');

    if (!navigator.mediaDevices?.enumerateDevices) {
        micSelectEl.innerHTML = '<option value="">Nicht unterstützt</option>';
        updateMicStatus('Geräteliste wird von diesem Browser nicht unterstützt.');
        return;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        state.micDevices = audioInputs;
        micSelectEl.innerHTML = '';

        if (audioInputs.length === 0) {
            const option = document.createElement('option');

            option.value = '';
            option.textContent = 'Kein Mikrofon gefunden';
            micSelectEl.appendChild(option);
            micSelectEl.disabled = true;
            updateMicStatus('Kein Mikrofon erkannt.');
            return;
        }

        audioInputs.forEach((device, index) => {
            const option = document.createElement('option');
            const label = device.label || `Mikrofon ${index + 1}`;

            option.value = device.deviceId;
            option.textContent = label;
            micSelectEl.appendChild(option);
        });

        if (!state.selectedMicId || !audioInputs.some(device => device.deviceId === state.selectedMicId)) {
            state.selectedMicId = audioInputs[0].deviceId;
        }

        micSelectEl.value = state.selectedMicId;
        micSelectEl.disabled = false;

        updateMicStatus();
        persistMicSelection();
    } catch (error) {
        micSelectEl.innerHTML = '<option value="">Fehler beim Laden</option>';
        micSelectEl.disabled = true;
        updateMicStatus(`Mikrofone konnten nicht geladen werden: ${error.message}`);
    }
}

updateJoinForm();
updateConsentUI();
loadMicrophones();

if (consentCheckbox && consentConfirmBtn) {
    consentCheckbox.onchange = () => {
        consentConfirmBtn.disabled = !consentCheckbox.checked;
    };

    consentConfirmBtn.onclick = () => {
        state.consentGiven = true;
        sessionStorage.setItem('consentGiven', 'true');
        updateConsentUI();
        persistMicSelection();
        updateJoinForm();
    };
}

if (micSelectEl) {
    micSelectEl.onchange = () => {
        state.selectedMicId = micSelectEl.value || undefined;
        persistMicSelection();
        const wasTesting = Boolean(state.micTest.analyser);

        updateMicStatus();

        if (wasTesting) {
            startMicTest();
        }
    };
}

if (micTestBtn) {
    micTestBtn.onclick = () => {
        if (state.micTest.analyser) {
            stopMicTest();
        } else {
            startMicTest();
        }
    };
}

if (navigator.mediaDevices) {
    if (typeof navigator.mediaDevices.addEventListener === 'function') {
        navigator.mediaDevices.addEventListener('devicechange', loadMicrophones);
    } else if ('ondevicechange' in navigator.mediaDevices) {
        navigator.mediaDevices.ondevicechange = loadMicrophones;
    }
}

window.addEventListener('beforeunload', stopMicTest);

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

async function connect() {
    stopMicTest();

    // Create local tracks
    const trackOptions = { devices: [ 'audio', 'video' ] };

    if (state.selectedMicId) {
        trackOptions.micDeviceId = state.selectedMicId;
    }

    const localTracks = await JitsiMeetJS.createLocalTracks(trackOptions);
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

    state.conference = c;
}

// Leave the room and proceed to cleanup.
async function leave() {
    if (state.conference) {
        await state.conference.dispose();
    }

    state.conference = undefined;
}

// Initialize library.
JitsiMeetJS.init();
console.log(`using LJM version ${JitsiMeetJS.version}!`);
