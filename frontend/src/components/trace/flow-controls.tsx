'use client';

import { Gauge, Layers, Pause, Play, SkipBack, SkipForward, Timer, X } from 'lucide-react';
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlaybackMode } from '@/hooks/use-trace-playback';
import type { FlowStep } from '@/lib/oir/trace-flow';

interface FlowControlsProps {
  isPlaying: boolean;
  currentStep: number;
  totalSteps: number;
  speed: number;
  mode: PlaybackMode;
  currentFlowStep: FlowStep | null;
  callStack: FlowStep[];
  progress: number;
  onPlay: () => void;
  onPause: () => void;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSeekTo: (step: number) => void;
  onSetSpeed: (speed: number) => void;
  onSetMode: (mode: PlaybackMode) => void;
  onExit: () => void;
}

const SPEED_OPTIONS = [
  { value: '0.25', label: '0.25x' },
  { value: '0.5', label: '0.5x' },
  { value: '1', label: '1x' },
  { value: '2', label: '2x' },
  { value: '4', label: '4x' },
];

function FlowControlsComponent({
  isPlaying,
  currentStep,
  totalSteps,
  speed,
  mode,
  currentFlowStep,
  callStack,
  progress,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onSeekTo,
  onSetSpeed,
  onSetMode,
  onExit,
}: FlowControlsProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <div className="bg-background/95 backdrop-blur-md border rounded-xl shadow-2xl px-4 py-3 flex flex-col gap-2 min-w-[520px] max-w-[680px]">
        {/* Top row: current span info */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {currentFlowStep ? (
              <>
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px] font-mono bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30"
                >
                  {currentFlowStep.operation}
                </Badge>
                {currentFlowStep.serviceName && (
                  <span className="text-xs text-muted-foreground truncate">
                    {currentFlowStep.serviceName}
                  </span>
                )}
                {currentFlowStep.durationMs != null && (
                  <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
                    <Timer className="h-2.5 w-2.5 mr-1" />
                    {currentFlowStep.durationMs}ms
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Ready to play</span>
            )}
          </div>

          {/* Call stack depth indicator */}
          {callStack.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="shrink-0 text-[10px] font-mono cursor-help">
                  <Layers className="h-2.5 w-2.5 mr-1" />
                  depth {callStack.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px]">
                <p className="text-xs font-medium mb-1">Call Stack</p>
                <div className="space-y-0.5">
                  {callStack.map((s, i) => (
                    <p key={s.spanId} className="text-[10px] font-mono text-muted-foreground">
                      {'  '.repeat(i)}
                      {i > 0 ? '└ ' : ''}
                      {s.operation}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Step counter */}
          <span className="text-xs font-mono text-muted-foreground shrink-0 tabular-nums">
            {currentStep + 1}/{totalSteps}
          </span>
        </div>

        {/* Timeline scrubber */}
        <Slider
          value={[currentStep]}
          min={0}
          max={Math.max(totalSteps - 1, 0)}
          step={1}
          onValueChange={([v]) => onSeekTo(v)}
          className="[&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:bg-cyan-500"
        />

        {/* Bottom row: controls */}
        <div className="flex items-center justify-between gap-2">
          {/* Transport controls */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onStepBackward}
                  disabled={currentStep <= 0}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Step back</TooltipContent>
            </Tooltip>

            <Button
              variant="default"
              size="icon"
              className="h-9 w-9 rounded-full bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={onTogglePlay}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onStepForward}
                  disabled={currentStep >= totalSteps - 1}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Step forward</TooltipContent>
            </Tooltip>
          </div>

          {/* Speed control */}
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            <Select value={String(speed)} onValueChange={(v) => onSetSpeed(Number(v))}>
              <SelectTrigger className="h-7 w-[72px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mode toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={mode === 'proportional' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onSetMode(mode === 'constant' ? 'proportional' : 'constant')}
              >
                <Timer className="h-3 w-3" />
                {mode === 'proportional' ? 'Real-time' : 'Constant'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {mode === 'constant'
                ? 'Switch to real-time: step timing matches actual span durations'
                : 'Switch to constant: fixed time per step'}
            </TooltipContent>
          </Tooltip>

          {/* Exit replay */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={onExit}
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Exit replay</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export const FlowControls = memo(FlowControlsComponent);
