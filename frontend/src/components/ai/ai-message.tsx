'use client';

import { Sparkles, User } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface AIMessageProps {
  message: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  };
}

export function AIMessage({ message }: AIMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'}>
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={`
          max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed
          ${isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'}
        `}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.timestamp && (
          <p
            className={`text-[10px] mt-1 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}
          >
            {new Date(message.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  );
}
