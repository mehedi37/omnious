import ora from 'ora';
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
    logger.infoBox([
      `${logger.label('Key')} ${maskKey(creds.api_key)}`,
      creds.api_url ? `${logger.label('API URL')} ${creds.api_url}` : '',
    ].filter(Boolean), '● Auth Status');
    return;
  }

  logger.banner();
  console.log('');

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
  const spinner = ora({ isSilent: !!process.env['CI'] });
  spinner.start('Validating API key…');

  const client = new OmniousApiClient(apiUrl, apiKey);

  try {
    const healthy = await client.healthCheck();
    if (!healthy) {
      spinner.fail(`Cannot reach API at ${apiUrl}`);
      logger.dim('  Is the backend running? Check the API URL in your config.');
      process.exitCode = 1;
      return;
    }

    const result = await client.validateKey();
    spinner.succeed('Key validated');

    // Save credentials
    saveCredentials({
      api_key: apiKey,
      api_url: apiUrl,
    });

    logger.successBox([
      `${logger.label('Project')} ${result.project_name}`,
      `${logger.label('ID')} ${result.project_id}`,
      `${logger.label('Key')} ${maskKey(apiKey)}`,
      `${logger.label('Saved to')} ${logger.theme.muted('~/.omnious/credentials.json')}`,
    ], '✔ Authenticated');
  } catch (err: unknown) {
    spinner.fail('Authentication failed');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}
