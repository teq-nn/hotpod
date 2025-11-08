const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'www', 'env-config.js');
const PREFIX = 'HOT_POD_';

function parseEnv(raw) {
    const result = {};
    if (!raw) {
        return result;
    }

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
            continue;
        }

        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();

        if (!key) {
            continue;
        }

        if ((value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        result[key] = value;
    }

    return result;
}

function readEnvFile() {
    try {
        if (!fs.existsSync(ENV_PATH)) {
            return {};
        }

        const raw = fs.readFileSync(ENV_PATH, 'utf8');
        return parseEnv(raw);
    } catch (error) {
        console.warn('[prepare-env] Failed to read .env file:', error);
        return {};
    }
}

function collectPrefixedEntries(source) {
    return Object.fromEntries(
        Object.entries(source)
            .filter(([ key ]) => key.startsWith(PREFIX))
    );
}

function buildConfig() {
    const fromFile = readEnvFile();
    const fromProcess = collectPrefixedEntries(process.env);

    return {
        ...fromFile,
        ...fromProcess,
    };
}

function ensureOutputDir() {
    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function writeConfig(config) {
    const serialized = JSON.stringify(config, null, 2);
    const banner = '// Auto-generated from .env by scripts/prepare-env.js\n';
    const content = `${banner}window.__HOT_POD_ENV__ = ${serialized};\n`;

    ensureOutputDir();

    try {
        const existing = fs.existsSync(OUTPUT_PATH)
            ? fs.readFileSync(OUTPUT_PATH, 'utf8')
            : null;

        if (existing === content) {
            return;
        }

        fs.writeFileSync(OUTPUT_PATH, content, 'utf8');
        console.log('[prepare-env] Wrote', path.relative(PROJECT_ROOT, OUTPUT_PATH));
    } catch (error) {
        console.error('[prepare-env] Failed to write env-config.js:', error);
        process.exitCode = 1;
    }
}

writeConfig(buildConfig());
