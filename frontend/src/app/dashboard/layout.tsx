import { AppSidebar } from '@/components/shared/app-sidebar';
import { CommandPalette } from '@/components/shared/command-palette';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="h-dvh overflow-hidden">
      <AppSidebar />
      <SidebarInset className="overflow-hidden flex flex-col min-w-0">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground truncate">Omnious</span>
        </header>
        <main className="flex-1 overflow-hidden min-h-0">{children}</main>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
