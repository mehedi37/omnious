'use client';

import { createClient as createBrowserClient } from '@/lib/supabase/client';
import { useAIStore } from '@/lib/stores/ai-store';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Stream a standalone AI chat response from /api/ai/stream-chat.
 *
 * - Adds an empty assistant message to the store before streaming
 * - Incrementally appends deltas via `appendToLastMessage`
 * - Sets streaming = false when done (or on error)
 * - Throws on connection/auth errors so callers can show error state
 */
export async function streamChat(
  messages: ChatMessage[],
  sessionId: string,
  projectId: string,
  modelTier: 'auto' | 'fast' | 'powerful' = 'auto',
): Promise<void> {
  const supabase = createBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  // Seed an empty assistant message so streaming deltas render immediately
  useAIStore.getState().addMessage({ role: 'assistant', content: '', timestamp: new Date().toISOString() });
  useAIStore.getState().setStreaming(true);

  let resp: Response;
  try {
    resp = await fetch(`${apiBase}/api/ai/stream-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        projectId,
        sessionId,
        messages,
        modelPreference: modelTier,
      }),
    });
  } catch (err) {
    useAIStore.getState().setStreaming(false);
    throw err;
  }

  if (!resp.ok) {
    useAIStore.getState().setStreaming(false);
    throw new Error(`AI request failed (${resp.status}). Ensure Ollama is running and reachable.`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        try {
          const event = JSON.parse(raw) as
            | { type: 'delta'; text: string }
            | { type: 'done' }
            | { type: 'error'; message: string };

          if (event.type === 'delta') {
            useAIStore.getState().appendToLastMessage(event.text);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
          // 'done' — nothing to do, loop will end naturally
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue; // skip malformed SSE lines
          throw parseErr;
        }
      }
    }
  } finally {
    useAIStore.getState().setStreaming(false);
  }
}
