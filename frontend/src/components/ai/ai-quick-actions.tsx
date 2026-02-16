'use client';

import { Zap, Bug, Shield, Languages, HelpCircle, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AISessionType } from '@/lib/oir/types';

interface AIQuickActionsProps {
  onAction: (sessionType: AISessionType, prompt: string) => void;
}

const QUICK_ACTIONS: Array<{
  type: AISessionType;
  label: string;
  prompt: string;
  icon: typeof Zap;
  color: string;
}> = [
  {
    type: 'explain_flow',
    label: 'Explain Flow',
    prompt: 'Explain the main data flow through this project — from entry points to database operations.',
    icon: GitBranch,
    color: 'text-blue-600 dark:text-blue-400',
  },
  {
    type: 'why_broke',
    label: 'Why Did It Break?',
    prompt: 'Analyze the most recent errors and explain their root causes.',
    icon: Bug,
    color: 'text-red-600 dark:text-red-400',
  },
  {
    type: 'fix_it',
    label: 'Fix It',
    prompt: 'Suggest fixes for the top unresolved errors in this project.',
    icon: Zap,
    color: 'text-amber-600 dark:text-amber-400',
  },
  {
    type: 'security_scan',
    label: 'Security Scan',
    prompt: 'Scan for potential security vulnerabilities — SQL injection, XSS, auth bypass, etc.',
    icon: Shield,
    color: 'text-green-600 dark:text-green-400',
  },
  {
    type: 'translate',
    label: 'Translate',
    prompt: 'Help me translate or port code between languages or frameworks.',
    icon: Languages,
    color: 'text-purple-600 dark:text-purple-400',
  },
  {
    type: 'general',
    label: 'General Question',
    prompt: '',
    icon: HelpCircle,
    color: 'text-muted-foreground',
  },
];

export function AIQuickActions({ onAction }: AIQuickActionsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg">
      {QUICK_ACTIONS.filter((a) => a.prompt).map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.type}
            variant="outline"
            className="h-auto flex-col gap-2 py-4 px-3"
            onClick={() => onAction(action.type, action.prompt)}
          >
            <Icon className={`h-5 w-5 ${action.color}`} />
            <span className="text-xs">{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
