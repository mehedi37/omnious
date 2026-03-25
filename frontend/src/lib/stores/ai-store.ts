import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AISessionType } from '../oir/types';

export interface AIMessageAttachment {
  kind: 'node' | 'module' | 'function' | 'file' | 'error';
  id: string;
  label: string;
  subtype?: string;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  attachments?: AIMessageAttachment[];
}

interface AIState {
  projectId: string | null;
  activeSessionId: string | null;
  sessionType: AISessionType | null;
  messages: AIMessage[];
  isStreaming: boolean;
  tokenUsage: { prompt: number; completion: number; total: number };
  // Actions
  setProjectId: (id: string | null) => void;
  setActiveSession: (sessionId: string, type: AISessionType, messages?: AIMessage[]) => void;
  clearSession: () => void;
  addMessage: (message: AIMessage) => void;
  appendToLastMessage: (delta: string) => void;
  setStreaming: (val: boolean) => void;
  setTokenUsage: (usage: { prompt: number; completion: number; total: number }) => void;
  prefillMessage: string | null;
  setPrefillMessage: (text: string | null) => void;
  /** Set by one-click error explain: triggers AI panel to auto-explain this error */
  pendingErrorExplain: { errorId: string; nodeId: string; nodeName: string } | null;
  setPendingErrorExplain: (info: { errorId: string; nodeId: string; nodeName: string } | null) => void;
}

export const useAIStore = create<AIState>()(
  immer((set) => ({
    projectId: null,
    activeSessionId: null,
    sessionType: null,
    messages: [],
    isStreaming: false,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    prefillMessage: null,
    pendingErrorExplain: null,

    setProjectId: (id) =>
      set((state) => {
        if (state.projectId !== id) {
          state.activeSessionId = null;
          state.sessionType = null;
          state.messages = [];
          state.isStreaming = false;
          state.tokenUsage = { prompt: 0, completion: 0, total: 0 };
        }
        state.projectId = id;
      }),

    setActiveSession: (sessionId, type, messages = []) =>
      set((state) => {
        state.activeSessionId = sessionId;
        state.sessionType = type;
        state.messages = messages;
      }),

    clearSession: () =>
      set((state) => {
        state.activeSessionId = null;
        state.sessionType = null;
        state.messages = [];
        state.isStreaming = false;
        state.tokenUsage = { prompt: 0, completion: 0, total: 0 };
      }),

    addMessage: (message) =>
      set((state) => {
        state.messages.push(message);
      }),

    appendToLastMessage: (delta) =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === 'assistant') {
          state.messages[state.messages.length - 1].content += delta;
        } else {
          state.messages.push({ role: 'assistant', content: delta });
        }
      }),

    setStreaming: (val) =>
      set((state) => {
        state.isStreaming = val;
      }),

    setTokenUsage: (usage) =>
      set((state) => {
        state.tokenUsage = usage;
      }),

    setPrefillMessage: (text) =>
      set((state) => {
        state.prefillMessage = text;
      }),

    setPendingErrorExplain: (info) =>
      set((state) => {
        state.pendingErrorExplain = info;
      }),
  })),
);
