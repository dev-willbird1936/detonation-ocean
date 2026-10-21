// Victim avatars for the scenario desktops: data/desktop-profiles/avatars/<id>.<png|jpg|webp|svg>, served as GET /avatars/<id>.
// The id is the world's user.avatar. Lookup is by exact id and a fixed extension list, never by a client-supplied path.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AVATAR_ID_RE = /^[a-z0-9-]{1,40}$/;
const AVATAR_DIR = 'data/desktop-profiles/avatars';
const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TYPES = Object.freeze([['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp'], ['svg', 'image/svg+xml']]);

// -> { bytes, mime } | null
export function readAvatar(root, id) {
  if (!AVATAR_ID_RE.test(id)) return null;
  for (const [extension, mime] of AVATAR_TYPES) {
    const file = join(root, AVATAR_DIR, `${id}.${extension}`);
    try {
      const stat = lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= AVATAR_MAX_BYTES) return { bytes: readFileSync(file), mime };
    } catch {
      // Try the next extension.
    }
  }
  return null;
}
