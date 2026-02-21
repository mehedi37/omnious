'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildFlowSteps, type FlowStep, getFlowTimeBounds } from '@/lib/oir/trace-flow';
import type { CodeEdge } from '@/lib/oir/types';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useTraceStore } from '@/lib/stores/trace-store';

export type PlaybackMode = 'constant' | 'proportional';

interface UseTracePlaybackReturn {
  // State
  isPlaying: boolean;
  currentStep: number;
  totalSteps: number;
  speed: number;
  mode: PlaybackMode;
  flowSteps: FlowStep[];
  currentFlowStep: FlowStep | null;
  callStack: FlowStep[];
  progress: number; // 0-100

  // Controls
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  seekTo: (stepIndex: number) => void;
  setSpeed: (speed: number) => void;
  setMode: (mode: PlaybackMode) => void;
  exitReplay: () => void;

  // Setup
  startReplay: (
    traceId: string,
    spans: import('@/lib/oir/types').Span[],
    staticEdges: CodeEdge[],
  ) => void;
}

/**
 * Enhanced trace playback hook.
 *
 * Uses FlowStep[] from the span-to-edge mapping engine.
 * Supports variable speed, proportional timing, scrubbing, and step controls.
 */
export function useTracePlayback(): UseTracePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<PlaybackMode>('constant');
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([]);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const stepRef = useRef(0);

  const timeBounds = useMemo(() => getFlowTimeBounds(flowSteps), [flowSteps]);

  const currentFlowStep = flowSteps[currentStep] ?? null;
  const callStack = useGraphStore((s) => s.callStack);

  const progress = flowSteps.length > 1 ? (currentStep / (flowSteps.length - 1)) * 100 : 0;

  // Apply a flow step to the graph store
  const applyStep = useCallback(
    (index: number) => {
      const step = flowSteps[index];
      if (!step) return;

      stepRef.current = index;
      setCurrentStep(index);
      useGraphStore.getState().setFlowStep(step);

      // Highlight the node in the trace store too
      if (step.nodeId) {
        useTraceStore.getState().setHighlightedNodeIds(new Set([step.nodeId]));
      }
    },
    [flowSteps],
  );

  // Calculate delay between steps
  const getStepDelay = useCallback(
    (stepIndex: number): number => {
      if (mode === 'constant') {
        // Constant speed: fixed interval per step
        return 800 / speed;
      }
      // Proportional mode: use actual span timing
      const current = flowSteps[stepIndex];
      const next = flowSteps[stepIndex + 1];
      if (!current || !next) return 500 / speed;

      const timeGap = next.startedAt - current.startedAt;
      // Scale proportionally but clamp to reasonable range
      const scaledGap = Math.max(50, Math.min(2000, timeGap)) / speed;
      return scaledGap;
    },
    [flowSteps, speed, mode],
  );

  // RAF animation loop
  const tick = useCallback(() => {
    const now = performance.now();
    const delay = getStepDelay(stepRef.current);

    if (now - lastTickRef.current >= delay) {
      const nextStep = stepRef.current + 1;
      if (nextStep >= flowSteps.length) {
        // End of replay
        setIsPlaying(false);
        return;
      }
      applyStep(nextStep);
      lastTickRef.current = now;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [flowSteps, applyStep, getStepDelay]);

  // Start/stop RAF loop
  useEffect(() => {
    if (isPlaying && flowSteps.length > 0) {
      lastTickRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, tick, flowSteps.length]);

  // ── Controls ──

  const play = useCallback(() => {
    if (flowSteps.length === 0) return;
    // If at end, restart from beginning
    if (stepRef.current >= flowSteps.length - 1) {
      // Reset graph state for replay restart
      useGraphStore.getState().startFlowReplay([]);
      applyStep(0);
    }
    setIsPlaying(true);
  }, [flowSteps, applyStep]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const stepForward = useCallback(() => {
    if (stepRef.current < flowSteps.length - 1) {
      setIsPlaying(false);
      applyStep(stepRef.current + 1);
    }
  }, [flowSteps, applyStep]);

  const stepBackward = useCallback(() => {
    if (stepRef.current > 0) {
      setIsPlaying(false);
      // Need to rebuild completed/error state up to the target step
      const targetStep = stepRef.current - 1;
      replayUpTo(targetStep);
    }
  }, [flowSteps]);

  const seekTo = useCallback(
    (stepIndex: number) => {
      const clamped = Math.max(0, Math.min(stepIndex, flowSteps.length - 1));
      setIsPlaying(false);
      replayUpTo(clamped);
    },
    [flowSteps],
  );

  // Rebuild graph state up to a specific step (for seeking/stepping backward)
  const replayUpTo = useCallback(
    (targetIndex: number) => {
      // Clear and rebuild
      const gs = useGraphStore.getState();
      gs.clearFlowReplay();
      gs.startFlowReplay([]); // re-enter replay mode

      for (let i = 0; i <= targetIndex; i++) {
        const step = flowSteps[i];
        if (step) gs.setFlowStep(step);
      }

      stepRef.current = targetIndex;
      setCurrentStep(targetIndex);

      const step = flowSteps[targetIndex];
      if (step?.nodeId) {
        useTraceStore.getState().setHighlightedNodeIds(new Set([step.nodeId]));
      }
    },
    [flowSteps],
  );

  const exitReplay = useCallback(() => {
    setIsPlaying(false);
    setFlowSteps([]);
    setCurrentStep(0);
    stepRef.current = 0;
    useGraphStore.getState().clearFlowReplay();
    useTraceStore.getState().clearActiveTrace();
  }, []);

  const startReplay = useCallback(
    (traceId: string, spans: import('@/lib/oir/types').Span[], staticEdges: CodeEdge[]) => {
      const { steps, runtimeEdges } = buildFlowSteps(spans, staticEdges);

      if (steps.length === 0) return;

      setFlowSteps(steps);
      stepRef.current = 0;
      setCurrentStep(0);

      // Set up graph store
      useGraphStore.getState().startFlowReplay(runtimeEdges);

      // Set active trace
      useTraceStore.getState().setActiveTrace(traceId, spans);

      // Apply first step
      useGraphStore.getState().setFlowStep(steps[0]);
      if (steps[0].nodeId) {
        useTraceStore.getState().setHighlightedNodeIds(new Set([steps[0].nodeId]));
      }

      // Start playing
      setIsPlaying(true);
    },
    [],
  );

  return {
    isPlaying,
    currentStep,
    totalSteps: flowSteps.length,
    speed,
    mode,
    flowSteps,
    currentFlowStep,
    callStack,
    progress,

    play,
    pause,
    togglePlay,
    stepForward,
    stepBackward,
    seekTo,
    setSpeed,
    setMode,
    exitReplay,
    startReplay,
  };
}
