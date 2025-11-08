import { uuid } from '../utils/helpers.js';

const EVENT_PREFIX = 'hotpod:';

export const SessionEvents = {
    STATE_CHANGED: `${EVENT_PREFIX}state`,
    TRACK_ADDED: `${EVENT_PREFIX}track-added`,
    TRACK_REMOVED: `${EVENT_PREFIX}track-removed`,
    CONFERENCE_JOINED: `${EVENT_PREFIX}conference-joined`,
    CONFERENCE_LEFT: `${EVENT_PREFIX}conference-left`,
    PARTICIPANT_JOINED: `${EVENT_PREFIX}participant-joined`,
    PARTICIPANT_LEFT: `${EVENT_PREFIX}participant-left`,
    RECORDING_COMMAND: `${EVENT_PREFIX}recording-command`
};

export class SessionController extends EventTarget {
    constructor({ domain, appId, room, jwt, isHost, telemetry }) {
        super();
        this.domain = domain;
        this.appId = appId;
        this.room = room;
        this.jwt = jwt;
        this.isHost = isHost;
        this.telemetry = telemetry;
        this.conference = undefined;
        this.localTracks = [];
        this.remoteAudioNodes = new Map();
        this._recentCommands = new Set();
        this._cleanCommandInterval = setInterval(() => this._pruneCommands(), 60_000);
    }

    async join({ audioDeviceId }) {
        this._assertCanJoin();

        const tracks = await JitsiMeetJS.createLocalTracks({
            devices: [ 'audio' ],
            micDeviceId: audioDeviceId || undefined
        });

        const joinOptions = { tracks };
        const conference = await JitsiMeetJS.joinConference(this.room, this.appId, this.jwt, joinOptions);

        this.localTracks = tracks;
        this.conference = conference;
        this._attachConferenceListeners(conference);
        this.dispatchEvent(new CustomEvent(SessionEvents.CONFERENCE_JOINED));
    }

    async leave() {
        if (this.conference) {
            await this.conference.dispose();
            this.conference = undefined;
        }

        for (const track of this.localTracks) {
            try {
                track.dispose();
            } catch (err) {
                console.warn('dispose track failed', err);
            }
        }

        this.localTracks = [];
        this._cleanupAudioNodes();
        this.dispatchEvent(new CustomEvent(SessionEvents.CONFERENCE_LEFT));
    }

    broadcastRecordingCommand(type, timestamp, payload = {}) {
        if (!this.isHost) {
            throw new Error('Only the host may broadcast recording commands.');
        }

        if (!this.conference) {
            throw new Error('Conference not joined.');
        }

        const message = {
            id: uuid(),
            type,
            ts: timestamp,
            ...payload
        };

        this.telemetry?.push('signalling:send', message);
        this.conference.sendEndpointMessage('', { hotpod: message });
        this._handleRecordingCommand(message, true);
    }

    _assertCanJoin() {
        if (!this.appId || !this.room || !this.jwt) {
            throw new Error('Missing required join parameters (appId, room or jwt).');
        }
    }

    _attachConferenceListeners(conference) {
        conference.on(
            JitsiMeetJS.events.conference.TRACK_ADDED,
            track => this._onTrackAdded(track));
        conference.on(
            JitsiMeetJS.events.conference.TRACK_REMOVED,
            track => this._onTrackRemoved(track));
        conference.on(
            JitsiMeetJS.events.conference.CONFERENCE_LEFT,
            () => this.dispatchEvent(new CustomEvent(SessionEvents.CONFERENCE_LEFT)));
        conference.on(
            JitsiMeetJS.events.conference.USER_JOINED,
            (id, participant) => {
                this.telemetry?.push('participant:joined', { id, isLocal: participant?.isLocal?.() });
                this.dispatchEvent(new CustomEvent(SessionEvents.PARTICIPANT_JOINED, { detail: { id, participant } }));
            });
        conference.on(
            JitsiMeetJS.events.conference.USER_LEFT,
            id => {
                this.telemetry?.push('participant:left', { id });
                this.dispatchEvent(new CustomEvent(SessionEvents.PARTICIPANT_LEFT, { detail: { id } }));
            });
        conference.on(
            JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED,
            (_, payload) => {
                if (!payload?.hotpod) {
                    return;
                }

                this._handleRecordingCommand(payload.hotpod, false);
            });
    }

    _onTrackAdded(track) {
        if (track.getType() === 'video') {
            return; // Video is not part of the PoC capture pipeline.
        }

        if (track.isLocal()) {
            this.dispatchEvent(new CustomEvent(SessionEvents.TRACK_ADDED, {
                detail: this._describeTrack(track, true)
            }));
            return;
        }

        const audioNode = document.createElement('audio');
        audioNode.autoplay = true;
        audioNode.id = `remote-${track.getId()}`;
        audioNode.style.display = 'none';
        document.body.appendChild(audioNode);
        track.attach(audioNode);
        this.remoteAudioNodes.set(track.getId(), audioNode);
        this.dispatchEvent(new CustomEvent(SessionEvents.TRACK_ADDED, {
            detail: this._describeTrack(track, false)
        }));
    }

    _onTrackRemoved(track) {
        const trackId = track.getId();
        if (this.remoteAudioNodes.has(trackId)) {
            const node = this.remoteAudioNodes.get(trackId);
            node?.remove();
            this.remoteAudioNodes.delete(trackId);
        }

        track.dispose();
        this.dispatchEvent(new CustomEvent(SessionEvents.TRACK_REMOVED, {
            detail: {
                trackId,
                participantId: track.getParticipantId(),
                isLocal: track.isLocal(),
                type: track.getType()
            }
        }));
    }

    _describeTrack(track, isLocal) {
        const participant = this.conference?.getParticipantById(track.getParticipantId());
        return {
            id: track.getId(),
            participantId: track.getParticipantId(),
            isLocal,
            type: track.getType(),
            displayName: participant?.getDisplayName?.() || (isLocal ? 'You' : 'Guest'),
            track
        };
    }

    _handleRecordingCommand(command, localEcho) {
        if (!command?.id || !command?.type) {
            return;
        }

        if (this._recentCommands.has(command.id)) {
            return;
        }

        this._recentCommands.add(command.id);
        this.telemetry?.push(localEcho ? 'signalling:loopback' : 'signalling:received', command);
        this.dispatchEvent(new CustomEvent(SessionEvents.RECORDING_COMMAND, { detail: command }));
    }

    _cleanupAudioNodes() {
        for (const node of this.remoteAudioNodes.values()) {
            node.remove();
        }
        this.remoteAudioNodes.clear();
    }

    _pruneCommands() {
        if (!this._recentCommands.size) {
            return;
        }

        // In the PoC, we simply keep a rolling set and flush every minute.
        this._recentCommands.clear();
    }

    destroy() {
        clearInterval(this._cleanCommandInterval);
        this._cleanupAudioNodes();
    }
}
