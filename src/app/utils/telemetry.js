export class TelemetryBuffer extends EventTarget {
    constructor(enabled) {
        super();
        this.enabled = enabled;
        this.events = [];
    }

    push(type, payload = {}) {
        if (!this.enabled) {
            return;
        }

        this.events.push({
            id: this.events.length + 1,
            type,
            timestamp: new Date().toISOString(),
            payload
        });
        this.dispatchEvent(new CustomEvent('telemetry:update'));
    }

    toTableRows() {
        return this.events.map(event => `
            <tr>
                <td class="text-secondary">${event.id}</td>
                <td>${event.timestamp}</td>
                <td>${event.type}</td>
                <td class="text-break">${JSON.stringify(event.payload)}</td>
            </tr>
        `).join('');
    }
}
