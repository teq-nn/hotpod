const ROUTE_PARAMS = ['room', 'host'];

const DEFAULT_ROUTE = Object.freeze({
    room: '',
    host: '',
});

function normalizeValue(value) {
    if (value === null) {
        return '';
    }

    return value.trim();
}

export function parseRoute(search = window.location.search) {
    const params = new URLSearchParams(search);

    return {
        room: normalizeValue(params.get('room')),
        host: normalizeValue(params.get('host')),
    };
}

export class Router extends EventTarget {
    constructor(initialState = DEFAULT_ROUTE) {
        super();

        this.state = {
            ...DEFAULT_ROUTE,
            ...initialState,
        };

        this._handlePopState = this._handlePopState.bind(this);
        window.addEventListener('popstate', this._handlePopState);
    }

    dispose() {
        window.removeEventListener('popstate', this._handlePopState);
    }

    getState() {
        return { ...this.state };
    }

    setState(partialState) {
        const nextState = {
            ...this.state,
            ...partialState,
        };

        if (this._statesEqual(this.state, nextState)) {
            return;
        }

        this.state = nextState;
        this._applyToHistory();
        this.dispatchEvent(new CustomEvent('change', { detail: this.getState() }));
    }

    _handlePopState() {
        const nextState = parseRoute(window.location.search);

        if (this._statesEqual(this.state, nextState)) {
            return;
        }

        this.state = nextState;
        this.dispatchEvent(new CustomEvent('change', { detail: this.getState() }));
    }

    _statesEqual(a, b) {
        return ROUTE_PARAMS.every(key => a[key] === b[key]);
    }

    _applyToHistory() {
        const url = new URL(window.location.href);

        ROUTE_PARAMS.forEach(key => {
            const value = this.state[key];

            if (value === undefined || value === null || value === '') {
                url.searchParams.delete(key);
            } else {
                url.searchParams.set(key, value);
            }
        });

        history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
}

export function createRouter() {
    return new Router(parseRoute());
}
