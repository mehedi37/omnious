import { password } from '@inquirer/prompts';
import { saveCredentials, clearCredentials, loadCredentials } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';

interface LoginOptions {
  apiKey?: string;
  apiUrl?: string;
  logout?: boolean;
  status?: boolean;
}

/**
 * `omnious login` — authenticate with an API key
 */
export async function loginCommand(opts: LoginOptions): Promise<void> {
  // Handle logout
  if (opts.logout) {
    clearCredentials();
    logger.success('Logged out. Credentials removed.');
    return;
  }

  // Handle status check
  if (opts.status) {
    const creds = loadCredentials();
    if (!creds?.api_key) {
      logger.warn('Not authenticated. Run `omnious login` to authenticate.');
      return;
    }
    logger.info(`Authenticated with key: ${maskKey(creds.api_key)}`);
    if (creds.api_url) {
      logger.dim(`API URL: ${creds.api_url}`);
    }
    return;
  }

  // Resolve API URL
  let apiUrl = opts.apiUrl;
  if (!apiUrl) {
    try {
      const config = loadConfig();
      apiUrl = config.api.url;
    } catch {
      apiUrl = 'http://localhost:4000';
    }
  }

  // Get API key
  let apiKey = opts.apiKey;
  if (!apiKey) {
    apiKey = await password({
      message: 'Enter your project API key:',
      mask: '*',
    });
  }

  if (!apiKey || apiKey.trim().length === 0) {
    logger.error('API key is required.');
    process.exitCode = 1;
    return;
  }

  apiKey = apiKey.trim();

  // Validate key against backend
  logger.step('Validating API key...');

  const client = new OmniousApiClient(apiUrl, apiKey);

  try {
    const healthy = await client.healthCheck();
    if (!healthy) {
      logger.error(`Cannot reach API at ${apiUrl}`);
      logger.dim('Is the backend running? Check the API URL in your config.');
      process.exitCode = 1;
      return;
    }

    const result = await client.validateKey();
    logger.success(
      `Authenticated! Project: ${result.project_name} (${result.project_id})`,
    );

    // Save credentials
    saveCredentials({
      api_key: apiKey,
      api_url: apiUrl,
    });
    logger.dim('Credentials saved to ~/.omnious/credentials.json');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Authentication failed: ${msg}`);
    process.exitCode = 1;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}
