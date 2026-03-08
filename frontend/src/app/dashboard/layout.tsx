import { AppSidebar } from '@/components/shared/app-sidebar';
import { CommandPalette } from '@/components/shared/command-palette';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground truncate">Omnious</span>
        </header>
        <main className="flex-1 overflow-auto h-full">{children}</main>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
