import { formatDateISO, safeFileComponent, uuid } from '../utils/helpers.js';

export const RecordingEvents = {
    STATE_CHANGED: 'recording:state',
    TRACK_UPDATED: 'recording:track',
    EXPORT_READY: 'recording:export',
    SIDECAR_READY: 'recording:sidecar'
};

const TRACK_STATES = {
    IDLE: 'idle',
    RECORDING: 'recording',
    STOPPING: 'stopping',
    EXPORTED: 'exported'
};

const MIME_TYPE = 'audio/webm;codecs=opus';

export class RecordingManager extends EventTarget {
    constructor({ room, telemetry, domain }) {
        super();
        this.room = room;
        this.telemetry = telemetry;
        this.domain = domain;
        this.tracks = new Map();
        this.state = TRACK_STATES.IDLE;
        this.startTs = null;
        this.stopTs = null;
    }

    registerTrack(trackDescriptor) {
        if (trackDescriptor.type !== 'audio') {
            return;
        }

        if (this.tracks.has(trackDescriptor.id)) {
            return;
        }

        const entry = this._createEntry(trackDescriptor);
        this.tracks.set(trackDescriptor.id, entry);
        this._emitTrack(entry);

        if (this.state === 'recording') {
            this._startRecorder(entry, this.startTs);
        }
    }

    unregisterTrack(trackId) {
        const entry = this.tracks.get(trackId);
        if (!entry) {
            return;
        }

        if (entry.recorder && entry.state === TRACK_STATES.RECORDING) {
            entry.metadata.stopTs = entry.metadata.stopTs ?? Date.now();
            entry.recorder.stop();
        }

        this.tracks.delete(trackId);
    }

    startRecording(commandTimestamp) {
        if (this.state === TRACK_STATES.RECORDING) {
            return;
        }

        this.state = TRACK_STATES.RECORDING;
        this.startTs = commandTimestamp;
        this.stopTs = null;
        this._emitState();
        this.telemetry?.push('recording:start', { ts: commandTimestamp, trackCount: this.tracks.size });

        for (const entry of this.tracks.values()) {
            this._startRecorder(entry, commandTimestamp);
        }
    }

    stopRecording(commandTimestamp) {
        if (this.state !== TRACK_STATES.RECORDING) {
            return;
        }

        this.state = TRACK_STATES.STOPPING;
        this.stopTs = commandTimestamp;
        this._emitState();
        this.telemetry?.push('recording:stop', { ts: commandTimestamp });

        for (const entry of this.tracks.values()) {
            if (entry.recorder && entry.state === TRACK_STATES.RECORDING) {
                entry.state = TRACK_STATES.STOPPING;
                entry.metadata.stopTs = commandTimestamp;
                entry.recorder.stop();
                this._emitTrack(entry);
            }
        }
    }

    reset() {
        this.state = TRACK_STATES.IDLE;
        this.startTs = null;
        this.stopTs = null;
        this.tracks.clear();
        this._emitState();
    }

    _createEntry(trackDescriptor) {
        const streamTrack = trackDescriptor.track.getOriginalStreamTrack?.();
        const stream = new MediaStream();
        if (streamTrack) {
            stream.addTrack(streamTrack);
        } else {
            // Fallback: try attaching the public stream.
            const primaryStream = trackDescriptor.track.stream || trackDescriptor.track.getTrackAsMediaStream?.();
            if (primaryStream) {
                primaryStream.getAudioTracks().forEach(t => stream.addTrack(t));
            }
        }

        let recorder;
        try {
            recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE });
        } catch (error) {
            this.telemetry?.push('recording:mediarecorder-fallback', { message: error.message });
            recorder = new MediaRecorder(stream);
        }
        const entry = {
            id: trackDescriptor.id,
            participantId: trackDescriptor.participantId,
            displayName: trackDescriptor.displayName,
            type: trackDescriptor.type,
            isLocal: trackDescriptor.isLocal,
            stream,
            recorder,
            chunks: [],
            metadata: {
                id: uuid(),
                participantId: trackDescriptor.participantId,
                displayName: trackDescriptor.displayName,
                trackType: trackDescriptor.type,
                codecHint: 'opus',
                startTs: null,
                stopTs: null,
                durationMs: 0,
                sequence: 0
            },
            state: TRACK_STATES.IDLE,
            blob: null,
            fileName: null
        };

        recorder.ondataavailable = event => {
            if (event.data?.size) {
                entry.chunks.push(event.data);
                entry.metadata.sequence += 1;
            }
        };

        recorder.onstop = () => {
            if (!entry.metadata.stopTs) {
                entry.metadata.stopTs = Date.now();
            }
            const blob = new Blob(entry.chunks, { type: MIME_TYPE });
            entry.blob = blob;
            entry.metadata.durationMs = entry.metadata.stopTs - entry.metadata.startTs;
            entry.state = TRACK_STATES.EXPORTED;
            entry.fileName = this._buildFileName(entry);
            this._emitTrack(entry);
            this.dispatchEvent(new CustomEvent(RecordingEvents.EXPORT_READY, { detail: entry }));
            this._maybeEmitSidecar();
        };

        recorder.onerror = event => {
            this.telemetry?.push('recording:error', { message: event?.error?.message || 'Recorder error' });
        };

        return entry;
    }

    _startRecorder(entry, timestamp) {
        if (entry.state === TRACK_STATES.RECORDING) {
            return;
        }

        entry.metadata.startTs = timestamp;
        entry.metadata.stopTs = null;
        entry.chunks.length = 0;
        entry.metadata.sequence = 0;
        entry.state = TRACK_STATES.RECORDING;
        this._emitTrack(entry);
        try {
            entry.recorder.start(2000);
        } catch (error) {
            this.telemetry?.push('recording:start-error', { message: error.message });
        }
    }

    _buildFileName(entry) {
        const room = safeFileComponent(this.room) || 'room';
        const participant = safeFileComponent(entry.participantId) || 'participant';
        const display = safeFileComponent(entry.displayName);
        const iso = formatDateISO(new Date(entry.metadata.startTs));
        return `podcast_${room}_${participant}_${display}_${iso}.webm`;
    }

    _emitState() {
        this.dispatchEvent(new CustomEvent(RecordingEvents.STATE_CHANGED, {
            detail: {
                state: this.state,
                startTs: this.startTs,
                stopTs: this.stopTs
            }
        }));
    }

    _emitTrack(entry) {
        this.dispatchEvent(new CustomEvent(RecordingEvents.TRACK_UPDATED, {
            detail: {
                id: entry.id,
                participantId: entry.participantId,
                displayName: entry.displayName,
                isLocal: entry.isLocal,
                state: entry.state,
                metadata: { ...entry.metadata },
                fileName: entry.fileName,
                blob: entry.blob
            }
        }));
    }

    _maybeEmitSidecar() {
        if (this.state !== TRACK_STATES.STOPPING && this.state !== TRACK_STATES.IDLE) {
            return;
        }

        const completed = Array.from(this.tracks.values()).filter(entry => entry.state === TRACK_STATES.EXPORTED);
        if (!completed.length || completed.length !== this.tracks.size) {
            return;
        }

        const payload = {
            room: this.room,
            startTs: this.startTs,
            stopTs: this.stopTs,
            generatedAt: new Date().toISOString(),
            domain: this.domain,
            tracks: completed.map(entry => ({
                id: entry.metadata.id,
                participantId: entry.participantId,
                displayName: entry.displayName,
                trackType: entry.type,
                codecHint: entry.metadata.codecHint,
                startTs: entry.metadata.startTs,
                stopTs: entry.metadata.stopTs,
                durationMs: entry.metadata.durationMs,
                sequence: entry.metadata.sequence,
                fileName: entry.fileName
            }))
        };

        const fileName = `podcast_${safeFileComponent(this.room)}_${formatDateISO(new Date(this.startTs))}_metadata.json`;
        const blob = new Blob([ JSON.stringify(payload, null, 2) ], { type: 'application/json' });
        this.dispatchEvent(new CustomEvent(RecordingEvents.SIDECAR_READY, {
            detail: {
                blob,
                fileName,
                payload
            }
        }));
        this.telemetry?.push('recording:sidecar', { trackCount: payload.tracks.length });
        this.state = TRACK_STATES.EXPORTED;
        this._emitState();
    }
}
