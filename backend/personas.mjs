import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERSONAS_FILE = join(root, 'data', 'personas.json');
const FORBIDDEN_KEYS = new Set(['password', 'token', 'access_token', 'refresh_token', 'secret', 'private_key', 'credential']);

function inspectForCredentials(value, path = 'persona') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForCredentials(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`${path}.${key} is not allowed in a synthetic persona`);
    inspectForCredentials(child, `${path}.${key}`);
  }
}

export function validatePersonaManifest(manifest) {
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.personas) || !manifest.personas.length) {
    throw new Error('Invalid synthetic persona manifest');
  }

  const app = manifest.oauth_app;
  if (!app || typeof app.id !== 'string' || typeof app.name !== 'string' ||
      typeof app.publisher !== 'string' || typeof app.purpose !== 'string' ||
      !Array.isArray(app.requested_scopes) || !app.requested_scopes.length ||
      app.requested_scopes.some(scope => !['mail.read', 'files.read'].includes(scope))) {
    throw new Error('Invalid synthetic OAuth app manifest');
  }

  const ids = new Set();
  for (const persona of manifest.personas) {
    if (!persona || persona.synthetic !== true || typeof persona.id !== 'string' || !persona.id) {
      throw new Error('Each persona must have an id and synthetic=true');
    }
    if (ids.has(persona.id)) throw new Error(`Duplicate persona id: ${persona.id}`);
    ids.add(persona.id);
    if (typeof persona.email !== 'string' || !persona.email.toLowerCase().endsWith('.invalid')) {
      throw new Error(`${persona.id}: email must use the reserved .invalid domain`);
    }
    if (!persona.mailbox || typeof persona.mailbox.id !== 'string' || !Array.isArray(persona.mailbox.messages)) {
      throw new Error(`${persona.id}: synthetic mailbox is missing or invalid`);
    }
    for (const message of persona.mailbox.messages) {
      if (!message || typeof message.id !== 'string' || typeof message.subject !== 'string' ||
          typeof message.sender !== 'string' || !message.sender.toLowerCase().endsWith('.invalid')) {
        throw new Error(`${persona.id}: mailbox entries must use synthetic ids, subjects and .invalid senders`);
      }
    }
    inspectForCredentials(persona, `personas.${persona.id}`);
  }
  return manifest;
}

export function loadPersonas(path = PERSONAS_FILE) {
  return validatePersonaManifest(JSON.parse(readFileSync(path, 'utf8')));
}

export function findPersona(manifest, id) {
  return manifest.personas.find(persona => persona.id === id) ?? null;
}
