import { createRouter } from './router.js';
import { SessionService } from '../lib/jitsi/sessionService.js';

function qs(selector) {
    const element = document.querySelector(selector);

    if (!element) {
        throw new Error(`Missing element for selector: ${selector}`);
    }

    return element;
}

function createVideoNode(trackId) {
    const videoNode = document.createElement('video');

    videoNode.id = trackId;
    videoNode.className = 'jitsiTrack col-4 p-1';
    videoNode.autoplay = true;
    videoNode.playsInline = true;

    return videoNode;
}

function createAudioNode(trackId) {
    const audioNode = document.createElement('audio');

    audioNode.id = trackId;
    audioNode.className = 'jitsiTrack';
    audioNode.autoplay = true;

    return audioNode;
}

export class App {
    constructor() {
        this.router = createRouter();
        this.session = new SessionService(window.JitsiMeetJS);

        this.state = {
            appId: '',
            room: '',
            jwt: '',
            host: '',
            conferenceActive: false,
        };

        this.participants = new Map();
        this.trackNodes = new Map();

        this.elements = {
            appIdInput: qs('#appIdText'),
            roomInput: qs('#roomText'),
            hostInput: qs('#hostText'),
            jwtInput: qs('#jwtText'),
            joinButton: qs('#joinBtn'),
            leaveButton: qs('#leaveBtn'),
            meetingGrid: qs('#meeting-grid'),
            participantList: qs('#participantList'),
            hostLabel: qs('#hostLabel'),
        };

        this._bindRouter();
        this._bindUI();
        this._bindSessionEvents();
    }

    async init() {
        await this.session.init();

        const routeState = this.router.getState();
        this.state.room = routeState.room ?? '';
        this.state.host = routeState.host ?? '';

        this.elements.roomInput.value = this.state.room;
        this.elements.hostInput.value = this.state.host;
        this._updateHostLabel();
        this._updateJoinForm();
    }

    _bindRouter() {
        this.router.addEventListener('change', event => {
            const { room = '', host = '' } = event.detail;

            this.state.room = room;
            this.state.host = host;

            this.elements.roomInput.value = room;
            this.elements.hostInput.value = host;

            this._updateHostLabel();
            this._updateJoinForm();
        });
    }

    _bindUI() {
        const { appIdInput, roomInput, hostInput, jwtInput, joinButton, leaveButton } = this.elements;

        appIdInput.addEventListener('input', () => {
            this.state.appId = appIdInput.value.trim();
            this._updateJoinForm();
        });

        roomInput.addEventListener('input', () => {
            const roomValue = roomInput.value.trim();
            this.state.room = roomValue;
            this.router.setState({ room: roomValue });
            this._updateJoinForm();
        });

        hostInput.addEventListener('input', () => {
            const hostValue = hostInput.value.trim();
            this.state.host = hostValue;
            this.router.setState({ host: hostValue });
            this._updateHostLabel();
        });

        jwtInput.addEventListener('input', () => {
            this.state.jwt = jwtInput.value.trim();
            this._updateJoinForm();
        });

        joinButton.addEventListener('click', async () => {
            try {
                await this.session.join({
                    appId: this.state.appId,
                    room: this.state.room,
                    jwt: this.state.jwt,
                    host: this.state.host,
                });
                this.state.conferenceActive = true;
            } catch (error) {
                console.error('Failed to join conference', error);
            }

            this._updateJoinForm();
        });

        leaveButton.addEventListener('click', async () => {
            try {
                await this.session.leave();
            } catch (error) {
                console.error('Failed to leave conference', error);
                this._updateJoinForm();
            }
        });
    }

    _bindSessionEvents() {
        this.session.addEventListener('conference-joined', () => {
            this.state.conferenceActive = true;
            this._updateJoinForm();
        });

        this.session.addEventListener('conference-left', () => {
            this.state.conferenceActive = false;
            this.participants.clear();
            this._renderParticipants();
            this._cleanupTrackNodes();
            this._updateJoinForm();
        });

        this.session.addEventListener('participant-joined', event => {
            const { id, isLocal, displayName } = event.detail;

            this.participants.set(id, {
                id,
                isLocal,
                displayName: displayName || (isLocal ? 'You' : id),
            });

            this._renderParticipants();
        });

        this.session.addEventListener('participant-left', event => {
            const { id } = event.detail;
            this.participants.delete(id);
            this._renderParticipants();
        });

        this.session.addEventListener('track-added', event => {
            const { track } = event.detail;

            if (!track) {
                return;
            }

            this._attachTrack(track);
        });

        this.session.addEventListener('track-removed', event => {
            const { track } = event.detail;

            if (!track) {
                return;
            }

            this._detachTrack(track);
        });

        this.session.addEventListener('local-tracks', event => {
            const { tracks } = event.detail;

            tracks.forEach(track => this._attachTrack(track));
        });
    }

    _updateJoinForm() {
        const { appIdInput, roomInput, jwtInput, hostInput, joinButton, leaveButton } = this.elements;
        const { conferenceActive } = this.state;

        if (conferenceActive) {
            appIdInput.disabled = true;
            roomInput.disabled = true;
            jwtInput.disabled = true;
            hostInput.disabled = true;
            joinButton.disabled = true;
            leaveButton.disabled = false;
        } else {
            appIdInput.disabled = false;
            roomInput.disabled = false;
            jwtInput.disabled = false;
            hostInput.disabled = false;
            joinButton.disabled = !this.state.appId || !this.state.room || !this.state.jwt;
            leaveButton.disabled = true;
        }
    }

    _updateHostLabel() {
        if (!this.elements.hostLabel) {
            return;
        }

        this.elements.hostLabel.textContent = this.state.host ? `Host: ${this.state.host}` : 'Host: n/a';
    }

    _renderParticipants() {
        const list = this.elements.participantList;

        if (!list) {
            return;
        }

        list.innerHTML = '';

        this.participants.forEach(participant => {
            const item = document.createElement('li');
            item.className = 'list-group-item d-flex justify-content-between align-items-center';
            item.textContent = participant.displayName;

            if (participant.isLocal) {
                const badge = document.createElement('span');
                badge.className = 'badge bg-primary rounded-pill';
                badge.textContent = 'You';
                item.appendChild(badge);
            }

            list.appendChild(item);
        });
    }

    _attachTrack(track) {
        const trackId = track.getId();

        if (this.trackNodes.has(trackId)) {
            return;
        }

        if (track.getType() === 'video') {
            const videoNode = createVideoNode(trackId);

            this.trackNodes.set(trackId, videoNode);
            this.elements.meetingGrid.appendChild(videoNode);
            track.attach(videoNode);
        } else if (!track.isLocal()) {
            const audioNode = createAudioNode(trackId);

            this.trackNodes.set(trackId, audioNode);
            document.body.appendChild(audioNode);
            track.attach(audioNode);
        }
    }

    _detachTrack(track) {
        const trackId = track.getId();
        const node = this.trackNodes.get(trackId);

        if (!node) {
            return;
        }

        track.detach(node);
        node.remove();
        this.trackNodes.delete(trackId);
    }

    _cleanupTrackNodes() {
        this.trackNodes.forEach(node => {
            node.remove();
        });

        this.trackNodes.clear();
    }
}
