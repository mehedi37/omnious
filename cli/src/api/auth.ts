import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';

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

/** Resolve the user access token (for interactive flows like init -i) */
export function resolveAccessToken(): string | null {
  const creds = loadCredentials();
  return creds?.access_token ?? null;
}

// ── Device Flow ──

export interface DeviceFlowConfig {
  apiUrl: string;
  onUserCode: (info: {
    userCode: string;
    verificationUri: string;
  }) => void;
  onPolling?: () => void;
}

export interface DeviceFlowResult {
  access_token: string;
  refresh_token: string;
  user_email: string;
}

/**
 * Open a URL in the system browser.
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' :
    platform === 'win32' ? 'start' :
    'xdg-open';
  exec(`${cmd} ${JSON.stringify(url)}`);
}

/**
 * Execute the Device Flow OAuth dance:
 * 1. Request a device code from the backend
 * 2. Show the user code to the user
 * 3. Poll until the user authorizes or the code expires
 */
export async function deviceFlowLogin(config: DeviceFlowConfig): Promise<DeviceFlowResult> {
  const { apiUrl } = config;

  // Step 1: Request device code
  const codeRes = await fetch(`${apiUrl}/trpc/auth.deviceCodeRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: {} }),
  });

  if (!codeRes.ok) {
    throw new Error(`Failed to request device code: HTTP ${codeRes.status}`);
  }

  const codeJson = (await codeRes.json()) as {
    result?: { data: { json: {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    } } };
  };

  const codeData = codeJson.result?.data?.json;
  if (!codeData) {
    throw new Error('Unexpected response from deviceCodeRequest');
  }

  // Show user code
  config.onUserCode({
    userCode: codeData.user_code,
    verificationUri: codeData.verification_uri,
  });

  // Step 2: Poll until authorized
  const pollInterval = (codeData.interval ?? 5) * 1000;
  const expiresAt = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < expiresAt) {
    config.onPolling?.();
    await sleep(pollInterval);

    const encoded = encodeURIComponent(
      JSON.stringify({ json: { deviceCode: codeData.device_code } }),
    );

    try {
      const pollRes = await fetch(
        `${apiUrl}/trpc/auth.devicePoll?input=${encoded}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const pollJson = (await pollRes.json()) as {
        result?: { data: { json: DeviceFlowResult } };
        error?: { message: string };
      };

      if (pollRes.ok && pollJson.result?.data?.json?.access_token) {
        return pollJson.result.data.json;
      }

      const errMsg = pollJson.error?.message ?? '';
      if (errMsg === 'expired_token') {
        throw new Error('Device code expired. Please try again.');
      }
      // authorization_pending → keep polling
    } catch (err) {
      // Network error or expired — re-throw if it's our own error
      if (err instanceof Error && err.message.includes('expired')) throw err;
      // Otherwise keep polling (transient network issue)
    }
  }

  throw new Error('Device code expired (timeout). Please try again.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
