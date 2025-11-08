const DEFAULT_CONFIG = {
    domain: '8x8.vc',
    defaultAppId: '',
    defaultJwt: '',
    telemetry: {
        enabled: false
    }
};

function readBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return value === 'true' || value === '1';
    }

    return false;
}

export function getConfig() {
    const injected = window.HOTPOD_CONFIG || {};
    const telemetry = injected.telemetry || {};

    return {
        domain: injected.domain || DEFAULT_CONFIG.domain,
        defaultAppId: injected.defaultAppId ?? DEFAULT_CONFIG.defaultAppId,
        defaultJwt: injected.defaultJwt ?? DEFAULT_CONFIG.defaultJwt,
        telemetry: {
            enabled: readBoolean(telemetry.enabled ?? DEFAULT_CONFIG.telemetry.enabled)
        }
    };
}
