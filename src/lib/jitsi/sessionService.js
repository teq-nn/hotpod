const CONFERENCE_EVENTS = [
    'TRACK_ADDED',
    'TRACK_REMOVED',
    'CONFERENCE_JOINED',
    'CONFERENCE_LEFT',
    'USER_JOINED',
    'USER_LEFT',
];

export class SessionService extends EventTarget {
    constructor(JitsiMeetJS) {
        super();

        if (!JitsiMeetJS) {
            throw new Error('JitsiMeetJS global is required');
        }

        this.JitsiMeetJS = JitsiMeetJS;
        this.initialized = false;
        this.conference = undefined;
        this.localTracks = [];
        this._eventHandlers = new Map();
        this.currentHost = '';
    }

    async init() {
        if (this.initialized) {
            return;
        }

        this.JitsiMeetJS.init();
        this.initialized = true;
        this.dispatchEvent(new Event('ready'));
    }

    async join({ appId, room, jwt, host }) {
        await this.init();

        if (!appId || !room || !jwt) {
            throw new Error('appId, room and jwt are required to join a conference');
        }

        if (this.conference) {
            await this.leave();
        }

        this.localTracks = await this.JitsiMeetJS.createLocalTracks({
            devices: ['audio', 'video'],
        });

        const joinOptions = {
            tracks: this.localTracks,
        };

        this.currentHost = host ? host : '';

        if (this.currentHost) {
            joinOptions.userInfo = {
                displayName: this.currentHost,
            };
        }

        const conference = await this.JitsiMeetJS.joinConference(room, appId, jwt, joinOptions);

        this._bindConferenceEvents(conference);

        this.conference = conference;

        this.dispatchEvent(new CustomEvent('local-tracks', {
            detail: {
                tracks: this.localTracks.slice(),
            },
        }));

        return conference;
    }

    async leave() {
        if (!this.conference) {
            return;
        }

        this._unbindConferenceEvents();

        await this.conference.dispose();

        this.conference = undefined;

        this.localTracks.forEach(track => track.dispose());
        this.localTracks = [];
        this.currentHost = '';

        this.dispatchEvent(new Event('conference-left'));
    }

    _bindConferenceEvents(conference) {
        const { events } = this.JitsiMeetJS;
        const conferenceEvents = events.conference;

        this._attachHandler(conference, conferenceEvents.TRACK_ADDED, track => {
            this.dispatchEvent(new CustomEvent('track-added', {
                detail: {
                    track,
                    participantId: track.getParticipantId?.() ?? (track.isLocal() ? conference.myUserId() : undefined),
                    isLocal: track.isLocal(),
                },
            }));
        });

        this._attachHandler(conference, conferenceEvents.TRACK_REMOVED, track => {
            this.dispatchEvent(new CustomEvent('track-removed', {
                detail: {
                    track,
                    participantId: track.getParticipantId?.() ?? (track.isLocal() ? conference.myUserId() : undefined),
                    isLocal: track.isLocal(),
                },
            }));
        });

        this._attachHandler(conference, conferenceEvents.CONFERENCE_JOINED, () => {
            const userId = conference.myUserId();
            const displayName = this.currentHost || conference.getDisplayName?.() || 'You';

            if (this.currentHost && conference.setDisplayName) {
                conference.setDisplayName(this.currentHost);
            }

            this.dispatchEvent(new Event('conference-joined'));
            this.dispatchEvent(new CustomEvent('participant-joined', {
                detail: {
                    id: userId,
                    isLocal: true,
                    displayName,
                },
            }));
        });

        this._attachHandler(conference, conferenceEvents.CONFERENCE_LEFT, () => {
            this.dispatchEvent(new Event('conference-left'));
        });

        this._attachHandler(conference, conferenceEvents.USER_JOINED, (id, participant) => {
            this.dispatchEvent(new CustomEvent('participant-joined', {
                detail: {
                    id,
                    isLocal: false,
                    displayName: participant?.getDisplayName?.() ?? participant?._displayName ?? id,
                },
            }));
        });

        this._attachHandler(conference, conferenceEvents.USER_LEFT, id => {
            this.dispatchEvent(new CustomEvent('participant-left', {
                detail: {
                    id,
                    isLocal: false,
                },
            }));
        });
    }

    _attachHandler(conference, event, handler) {
        const boundHandler = handler.bind(this);

        conference.on(event, boundHandler);

        this._eventHandlers.set(event, boundHandler);
    }

    _unbindConferenceEvents() {
        if (!this.conference) {
            return;
        }

        const { events } = this.JitsiMeetJS;
        const conferenceEvents = events.conference;

        CONFERENCE_EVENTS.forEach(eventKey => {
            const event = conferenceEvents[eventKey];
            const handler = this._eventHandlers.get(event);

            if (handler) {
                this.conference.off(event, handler);
                this._eventHandlers.delete(event);
            }
        });
    }
}
