import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { findConfigPath } from '../config/loader.js';
import { logger } from '../utils/logger.js';

interface ConfigOptions {
  action: 'get' | 'set' | 'list';
  key?: string;
  value?: string;
}

/**
 * `omnious config` — view or modify .omnious.yml settings
 *
 * Usage:
 *   omnious config list            — show all settings
 *   omnious config get api.url     — get a specific setting
 *   omnious config set api.url URL — set a specific setting
 */
export async function configCommand(opts: ConfigOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = findConfigPath(cwd);

  if (!configPath) {
    logger.error('No .omnious.yml found. Run `omnious init` first.');
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const doc = YAML.parseDocument(raw);
  const config = doc.toJSON() as Record<string, unknown>;

  switch (opts.action) {
    case 'list': {
      logger.banner();
      console.log('');
      logger.section(`Config: ${path.relative(cwd, configPath)}`);
      printConfig(config, '');
      break;
    }

    case 'get': {
      if (!opts.key) {
        logger.error('Usage: omnious config get <key>');
        logger.dim('  Example: omnious config get api.url');
        process.exitCode = 1;
        return;
      }

      const value = getNestedValue(config, opts.key);
      if (value === undefined) {
        logger.warn(`Key "${opts.key}" not found in config.`);
        process.exitCode = 1;
      } else {
        console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
      }
      break;
    }

    case 'set': {
      if (!opts.key || opts.value === undefined) {
        logger.error('Usage: omnious config set <key> <value>');
        logger.dim('  Example: omnious config set api.url https://api.omnious.dev');
        process.exitCode = 1;
        return;
      }

      // Parse value (support booleans, numbers, strings)
      const parsed = parseValue(opts.value);

      // Set the value using YAML document API (preserves comments + formatting)
      setNestedValue(doc, opts.key, parsed);

      // Write back
      const updated = doc.toString();
      fs.writeFileSync(configPath, updated, 'utf-8');

      logger.step(`Set ${logger.theme.accent(opts.key)} = ${logger.theme.brand(String(parsed))}`);
      break;
    }
  }
}

/** Traverse a dot-separated key path to get a nested value */
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a value in a YAML document using dot-separated path */
function setNestedValue(doc: YAML.Document, key: string, value: unknown): void {
  const parts = key.split('.');

  if (parts.length === 1) {
    doc.set(parts[0]!, value);
    return;
  }

  // Navigate to parent, creating intermediate objects as needed
  let current = doc.contents as YAML.YAMLMap;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    let next = current.get(part, true) as YAML.YAMLMap | undefined;
    if (!next || !(next instanceof YAML.YAMLMap)) {
      next = doc.createNode({}) as YAML.YAMLMap;
      current.set(part, next);
    }
    current = next;
  }

  const lastKey = parts[parts.length - 1]!;
  current.set(lastKey, value);
}

/** Parse CLI value string into appropriate type */
function parseValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

/** Recursively print config for `config list` */
function printConfig(obj: Record<string, unknown>, prefix: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      printConfig(value as Record<string, unknown>, fullKey);
    } else if (Array.isArray(value)) {
      logger.kv(fullKey, value.map(String).join(', '));
    } else {
      logger.kv(fullKey, String(value));
    }
  }
}
