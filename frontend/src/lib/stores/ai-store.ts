import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AISessionType } from '../oir/types';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface AIState {
  activeSessionId: string | null;
  sessionType: AISessionType | null;
  messages: AIMessage[];
  isStreaming: boolean;
  tokenUsage: { prompt: number; completion: number; total: number };
  panelOpen: boolean;

  // Actions
  setActiveSession: (sessionId: string, type: AISessionType, messages?: AIMessage[]) => void;
  clearSession: () => void;
  addMessage: (message: AIMessage) => void;
  setStreaming: (val: boolean) => void;
  setTokenUsage: (usage: { prompt: number; completion: number; total: number }) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

export const useAIStore = create<AIState>()(
  immer((set) => ({
    activeSessionId: null,
    sessionType: null,
    messages: [],
    isStreaming: false,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    panelOpen: false,

    setActiveSession: (sessionId, type, messages = []) =>
      set((state) => {
        state.activeSessionId = sessionId;
        state.sessionType = type;
        state.messages = messages;
        state.panelOpen = true;
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

    setStreaming: (val) =>
      set((state) => {
        state.isStreaming = val;
      }),

    setTokenUsage: (usage) =>
      set((state) => {
        state.tokenUsage = usage;
      }),

    togglePanel: () =>
      set((state) => {
        state.panelOpen = !state.panelOpen;
      }),

    openPanel: () =>
      set((state) => {
        state.panelOpen = true;
      }),

    closePanel: () =>
      set((state) => {
        state.panelOpen = false;
      }),
  })),
);
