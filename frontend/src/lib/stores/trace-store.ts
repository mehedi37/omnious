import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Span, TraceStatus } from '../oir/types';

interface TraceState {
  activeTraceId: string | null;
  spans: Span[];
  playbackPosition: number; // ms from trace start
  isPlaying: boolean;
  playbackSpeed: number;
  highlightedNodeIds: Set<string>;

  // Actions
  setActiveTrace: (traceId: string, spans: Span[]) => void;
  clearActiveTrace: () => void;
  setPlaybackPosition: (ms: number) => void;
  togglePlayback: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setHighlightedNodeIds: (ids: Set<string>) => void;
}

export const useTraceStore = create<TraceState>()(
  immer((set) => ({
    activeTraceId: null,
    spans: [],
    playbackPosition: 0,
    isPlaying: false,
    playbackSpeed: 1,
    highlightedNodeIds: new Set<string>(),

    setActiveTrace: (traceId, spans) =>
      set((state) => {
        state.activeTraceId = traceId;
        state.spans = spans;
        state.playbackPosition = 0;
        state.isPlaying = false;
        state.highlightedNodeIds = new Set(
          spans.filter((s) => s.code_node_id).map((s) => s.code_node_id!),
        );
      }),

    clearActiveTrace: () =>
      set((state) => {
        state.activeTraceId = null;
        state.spans = [];
        state.playbackPosition = 0;
        state.isPlaying = false;
        state.highlightedNodeIds = new Set();
      }),

    setPlaybackPosition: (ms) =>
      set((state) => {
        state.playbackPosition = ms;
      }),

    togglePlayback: () =>
      set((state) => {
        state.isPlaying = !state.isPlaying;
      }),

    setPlaybackSpeed: (speed) =>
      set((state) => {
        state.playbackSpeed = speed;
      }),

    setHighlightedNodeIds: (ids) =>
      set((state) => {
        state.highlightedNodeIds = ids;
      }),
  })),
);
