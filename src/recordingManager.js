const DEFAULT_TIMESLICE_MS = 2000;

const VIDEO_MIME_TYPES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
];

const AUDIO_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
];

function selectMimeType(trackType) {
    if (typeof MediaRecorder === 'undefined') {
        return '';
    }

    const candidates = trackType === 'video' ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
    return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
}

function createRecorderStream(track) {
    const stream = new MediaStream();
    const mediaTrack = track.getTrack?.()
        || track.getOriginalTrack?.()
        || track.stream?.getTracks?.()[0];

    if (!mediaTrack) {
        return null;
    }

    try {
        const clone = mediaTrack.clone();
        stream.addTrack(clone);
        return { stream, clone };
    } catch (err) {
        try {
            stream.addTrack(mediaTrack);
            return { stream, clone: null };
        } catch (innerErr) {
            console.warn('RecordingManager: unable to prepare stream for track', track.getId?.(), innerErr);
            return null;
        }
    }
}

export class RecordingManager {
    constructor() {
        this.trackEntries = new Map();
        this.isRecording = false;
        this.timesliceMs = DEFAULT_TIMESLICE_MS;
        this._boundEndpointHandler = null;
        this.conference = null;
        this.clockOffset = 0;
        this.recordingStartTime = null;
        this.recordingStopTime = null;
    }

    attachConference(conference) {
        if (this.conference === conference) {
            return;
        }

        if (this.conference) {
            this.detachConference();
        }
        this.conference = conference;

        this._boundEndpointHandler = this._handleEndpointMessage.bind(this);
        conference.on(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, this._boundEndpointHandler);
    }

    detachConference() {
        if (this.conference && this._boundEndpointHandler) {
            this.conference.off(JitsiMeetJS.events.conference.ENDPOINT_MESSAGE_RECEIVED, this._boundEndpointHandler);
        }

        this._boundEndpointHandler = null;
        this.conference = null;
        this.reset();
    }

    reset() {
        this.stop();
        this.trackEntries.forEach(entry => this._releaseEntry(entry));
        this.trackEntries.clear();
        this.clockOffset = 0;
        this.recordingStartTime = null;
        this.recordingStopTime = null;
    }

    registerTrack(track) {
        if (!track) {
            return;
        }

        const id = track.getId?.();
        if (!id) {
            return;
        }

        const participantId = typeof track.getParticipantId === 'function'
            ? track.getParticipantId()
            : (track.isLocal?.() ? 'local' : 'remote');

        const existing = this.trackEntries.get(id);
        if (existing) {
            existing.track = track;
            existing.participantId = participantId;
            if (this.isRecording && (!existing.recorder || existing.recorder.state === 'inactive')) {
                this._startRecorderForEntry(existing);
            }
            return;
        }

        const entry = {
            id,
            track,
            participantId,
            recorder: null,
            recordingStream: null,
            mimeType: '',
            chunks: [],
            startedAt: null,
            endedAt: null,
        };

        this.trackEntries.set(id, entry);

        if (this.isRecording) {
            this._startRecorderForEntry(entry);
        }
    }

    unregisterTrack(track) {
        if (!track) {
            return;
        }

        const id = track.getId?.();
        if (!id) {
            return;
        }

        const entry = this.trackEntries.get(id);
        if (!entry) {
            return;
        }

        if (entry.recorder && entry.recorder.state !== 'inactive') {
            this._stopRecorderForEntry(entry, this._getGlobalNow());
        }

        this._releaseEntry(entry);
        this.trackEntries.delete(id);
    }

    start(timestamp) {
        if (this.isRecording) {
            return;
        }

        if (typeof MediaRecorder === 'undefined') {
            console.warn('RecordingManager: MediaRecorder API is not available.');
            return;
        }

        const now = performance.now();
        if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
            this.clockOffset = now - timestamp;
            this.recordingStartTime = timestamp;
        } else {
            this.clockOffset = 0;
            this.recordingStartTime = now;
        }

        this.isRecording = true;
        this.recordingStopTime = null;

        this.trackEntries.forEach(entry => {
            entry.chunks = [];
            entry.startedAt = null;
            entry.endedAt = null;
            this._startRecorderForEntry(entry);
        });

        console.log('RecordingManager: recording started', {
            startTime: this.recordingStartTime,
            trackCount: this.trackEntries.size,
        });
    }

    stop(timestamp) {
        if (!this.isRecording) {
            return;
        }

        const globalStopTime = (typeof timestamp === 'number' && Number.isFinite(timestamp))
            ? timestamp
            : this._getGlobalNow();

        this.recordingStopTime = globalStopTime;
        this.isRecording = false;

        this.trackEntries.forEach(entry => {
            if (entry.recorder && entry.recorder.state !== 'inactive') {
                this._stopRecorderForEntry(entry, globalStopTime);
            }
        });

        const summary = {};
        this.trackEntries.forEach(entry => {
            summary[entry.id] = {
                participantId: entry.participantId,
                trackType: entry.track?.getType?.(),
                chunks: entry.chunks.length,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
                mimeType: entry.mimeType,
            };
        });

        console.log('RecordingManager: recording stopped', {
            startTime: this.recordingStartTime,
            stopTime: this.recordingStopTime,
            tracks: summary,
        });
    }

    handleMessage(payload) {
        if (!payload) {
            return;
        }

        if (typeof payload === 'string') {
            if (payload === 'REC_START') {
                this.start();
            } else if (payload === 'REC_STOP') {
                this.stop();
            }
            return;
        }

        if (typeof payload !== 'object') {
            return;
        }

        const { type, timestamp } = payload;

        if (type === 'REC_START') {
            this.start(timestamp);
        } else if (type === 'REC_STOP') {
            this.stop(timestamp);
        }
    }

    _handleEndpointMessage(_participant, payload) {
        this.handleMessage(payload);
    }

    _startRecorderForEntry(entry) {
        const trackType = entry.track?.getType?.();
        const prepared = createRecorderStream(entry.track);

        if (!prepared) {
            return;
        }

        const { stream, clone } = prepared;
        const mimeType = selectMimeType(trackType);

        let recorder;
        try {
            recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);
        } catch (err) {
            console.warn('RecordingManager: failed to create MediaRecorder with mime type', mimeType, err);
            try {
                recorder = new MediaRecorder(stream);
            } catch (fallbackErr) {
                console.error('RecordingManager: MediaRecorder unavailable for track', entry.id, fallbackErr);
                stream.getTracks().forEach(t => t.stop());
                return;
            }
        }

        entry.mimeType = recorder.mimeType || mimeType || '';
        entry.recordingStream = stream;
        entry.startedAt = this._getGlobalNow();
        entry.endedAt = null;

        recorder.ondataavailable = event => {
            if (!event || !event.data || event.data.size === 0) {
                return;
            }

            entry.chunks.push({
                blob: event.data,
                timestamp: this._getGlobalNow(),
            });
        };

        recorder.onerror = error => {
            console.error('RecordingManager: recorder error for track', entry.id, error);
        };

        recorder.onstop = () => {
            entry.endedAt = entry.endedAt ?? this._getGlobalNow();
            if (entry.recordingStream) {
                entry.recordingStream.getTracks().forEach(t => t.stop());
            }
            entry.recordingStream = null;
            if (clone && typeof clone.stop === 'function') {
                clone.stop();
            }
            entry.recorder = null;
        };

        try {
            recorder.start(this.timesliceMs);
            entry.recorder = recorder;
        } catch (err) {
            console.error('RecordingManager: failed to start MediaRecorder for track', entry.id, err);
            recorder.stream?.getTracks().forEach(t => t.stop());
        }
    }

    _stopRecorderForEntry(entry, globalStopTime) {
        if (!entry.recorder) {
            return;
        }

        entry.endedAt = globalStopTime;

        try {
            if (typeof entry.recorder.requestData === 'function') {
                entry.recorder.requestData();
            }
        } catch (err) {
            console.warn('RecordingManager: failed to request data for track', entry.id, err);
        }

        try {
            entry.recorder.stop();
        } catch (err) {
            console.warn('RecordingManager: failed to stop recorder for track', entry.id, err);
        }
    }

    _releaseEntry(entry) {
        if (entry.recorder && entry.recorder.state !== 'inactive') {
            try {
                entry.recorder.stop();
            } catch (err) {
                console.warn('RecordingManager: error while releasing recorder', entry.id, err);
            }
        }

        if (entry.recordingStream) {
            entry.recordingStream.getTracks().forEach(t => t.stop());
            entry.recordingStream = null;
        }

        entry.recorder = null;
    }

    _getGlobalNow() {
        return performance.now() - this.clockOffset;
    }
}
