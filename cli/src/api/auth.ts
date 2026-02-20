import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CREDENTIALS_DIR = path.join(os.homedir(), '.omnious');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

export interface Credentials {
  api_key?: string;
  api_url?: string;
  access_token?: string;
  refresh_token?: string;
  user_email?: string;
}

/**
 * Load credentials from ~/.omnious/credentials.json
 * Warns if file permissions are too open.
 */
export function loadCredentials(): Credentials | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) return null;

  // Check file permissions (unix)
  try {
    const stat = fs.statSync(CREDENTIALS_FILE);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      console.warn(
        `⚠ Warning: ${CREDENTIALS_FILE} has permissions ${mode.toString(8)}. ` +
          'Expected 600. Run: chmod 600 ~/.omnious/credentials.json',
      );
    }
  } catch {
    // Skip permission check on platforms that don't support it
  }

  const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
  return JSON.parse(raw) as Credentials;
}

/**
 * Save credentials to ~/.omnious/credentials.json with chmod 600
 */
export function saveCredentials(creds: Credentials): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

/**
 * Remove credentials file
 */
export function clearCredentials(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Resolve the project API key from multiple sources (priority order):
 * 1. CLI flag (--api-key)
 * 2. Environment variable (OMNIOUS_PROJECT_KEY)
 * 3. Config file (.omnious.yml api.project_key)
 * 4. Credentials file (~/.omnious/credentials.json)
 */
export function resolveApiKey(opts: {
  cliFlag?: string;
  configKey?: string;
}): string | null {
  if (opts.cliFlag) return opts.cliFlag;
  if (process.env['OMNIOUS_PROJECT_KEY']) return process.env['OMNIOUS_PROJECT_KEY'];
  if (opts.configKey) return opts.configKey;

  const creds = loadCredentials();
  return creds?.api_key ?? null;
}
