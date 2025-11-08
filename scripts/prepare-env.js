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

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
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
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
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
    } catch (err) {
        console.error('Failed to read .env file', err);
        return {};
    }
}

function buildConfig(env) {
    const config = {};
    Object.keys(env).forEach(key => {
        if (key.startsWith(PREFIX)) {
            config[key] = env[key];
        }
    });
    return config;
}

function writeConfig(config) {
    const serialized = JSON.stringify(config, null, 2);
    const banner = '// Auto-generated from .env by scripts/prepare-env.js\n';
    const content = `${banner}window.__HOT_POD_ENV__ = ${serialized};\n`;
    fs.writeFileSync(OUTPUT_PATH, content);
}

const envVars = readEnvFile();
const config = buildConfig(envVars);
writeConfig(config);
