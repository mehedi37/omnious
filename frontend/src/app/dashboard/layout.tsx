import { AppSidebar } from '@/components/shared/app-sidebar';
import { CommandPalette } from '@/components/shared/command-palette';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
