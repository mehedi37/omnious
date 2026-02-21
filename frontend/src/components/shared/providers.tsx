'use client';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TRPCProvider } from '@/trpc/client';
import { ThemeProvider } from './theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCProvider>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster richColors closeButton position="bottom-right" />
        </TooltipProvider>
      </TRPCProvider>
    </ThemeProvider>
  );
}
