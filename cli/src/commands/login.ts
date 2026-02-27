import ora from 'ora';
import { password } from '@inquirer/prompts';
import {
  saveCredentials,
  clearCredentials,
  loadCredentials,
  deviceFlowLogin,
  openBrowser,
} from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config/loader.js';

interface LoginOptions {
  apiKey?: string;
  apiUrl?: string;
  logout?: boolean;
  status?: boolean;
  browser?: boolean;
}

/**
 * `omnious login` — authenticate with an API key or via Device Flow (browser)
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
    const lines: string[] = [];
    if (creds?.api_key) {
      lines.push(`${logger.label('API Key')} ${maskKey(creds.api_key)}`);
    }
    if (creds?.access_token) {
      lines.push(`${logger.label('User')} ${creds.user_email ?? 'authenticated'}`);
    }
    if (creds?.api_url) {
      lines.push(`${logger.label('API URL')} ${creds.api_url}`);
    }
    if (lines.length === 0) {
      logger.warn('Not authenticated. Run `omnious login` to authenticate.');
      return;
    }
    logger.infoBox(lines, '● Auth Status');
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

  // ── Device Flow (browser auth) ──
  if (opts.browser) {
    return deviceFlowLoginCommand(apiUrl);
  }

  // ── API Key auth (original flow) ──
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

/**
 * Device Flow login: open browser, show user code, poll for tokens.
 */
async function deviceFlowLoginCommand(apiUrl: string): Promise<void> {
  const spinner = ora({ isSilent: !!process.env['CI'] });

  try {
    spinner.start('Requesting device code…');

    const result = await deviceFlowLogin({
      apiUrl,
      onUserCode: ({ userCode, verificationUri }) => {
        spinner.stop();

        const fullUrl = `${verificationUri}?code=${userCode}`;

        logger.infoBox([
          `Open this URL in your browser:`,
          '',
          `  ${logger.theme.accent(fullUrl)}`,
          '',
          `And enter this code:`,
          '',
          `  ${logger.theme.brand(userCode)}`,
        ], '● Device Authorization');

        // Try to open browser automatically
        openBrowser(fullUrl);
        logger.dim('  (Attempting to open browser automatically…)');
        console.log('');
        spinner.start('Waiting for authorization…');
      },
      onPolling: () => {
        // Keep spinner alive
      },
    });

    spinner.succeed('Authorized!');

    // Save credentials
    saveCredentials({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      user_email: result.user_email,
      api_url: apiUrl,
    });

    logger.successBox([
      `${logger.label('User')} ${result.user_email}`,
      `${logger.label('Saved to')} ${logger.theme.muted('~/.omnious/credentials.json')}`,
    ], '✔ Authenticated via Browser');

    logger.infoBox([
      `${logger.theme.muted('→')} Create a project interactively:`,
      `   ${logger.theme.accent('omnious init -i')}`,
    ], 'Next Steps');
  } catch (err) {
    spinner.fail('Device flow failed');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '…' + key.slice(-4);
}