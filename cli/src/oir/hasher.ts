import crypto from 'node:crypto';

/**
 * Generate a deterministic OIR ID for a code node.
 * Uses SHA-256 of (file_path + name + type + normalized_signature), truncated to 32 hex chars.
 * The signature is whitespace-normalized so formatting changes don't alter the ID.
 */
export function generateOirId(
  filePath: string,
  name: string,
  type: string,
  signature: string,
): string {
  const normalizedSig = signature.replace(/\s+/g, ' ').trim();
  return crypto
    .createHash('sha256')
    .update(`${filePath}::${name}::${type}::${normalizedSig}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * SHA-256 hash of normalized file content.
 * Normalizes line endings and trims whitespace.
 */
export function hashFileContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * SHA-256 hash of extracted node source code (line range).
 */
export function hashNodeContent(
  source: string,
  lineStart: number,
  lineEnd: number,
): string {
  const lines = source.split('\n').slice(lineStart - 1, lineEnd);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Extract the code body for a node (first ~500 lines of the node's source).
 * Used for LLM context in AI queries and graph-aware embeddings.
 */
export function extractCodeBody(
  source: string,
  lineStart: number,
  lineEnd: number,
  maxLines = 500,
): string | null {
  const lines = source.split('\n').slice(lineStart - 1, Math.min(lineEnd, lineStart - 1 + maxLines));
  const body = lines.join('\n').trim();
  return body.length > 0 ? body : null;
}

/**
 * SHA-256 of the entire project index — sorted file hashes concatenated.
 * Used for quick sync comparison.
 */
export function hashProject(fileHashes: Map<string, string>): string {
  const sorted = [...fileHashes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const combined = sorted.map(([path, hash]) => `${path}:${hash}`).join('\n');
  return crypto.createHash('sha256').update(combined).digest('hex');
}
