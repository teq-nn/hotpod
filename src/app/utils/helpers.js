export function parseQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        room: params.get('room') || '',
        host: params.get('host') === '1' || params.get('host') === 'true',
        appId: params.get('appId') || '',
        jwt: params.get('jwt') || ''
    };
}

export function safeFileComponent(input) {
    if (!input) {
        return 'anon';
    }

    return input
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9-_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .toLowerCase();
}

export function formatDateISO(date = new Date()) {
    return date.toISOString().replace(/[:]/g, '-');
}

export function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return 'xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

export function isSafari() {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');
}
