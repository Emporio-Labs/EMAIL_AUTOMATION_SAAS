import { AuthGate } from "@/components/auth-gate";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr]">
        <Sidebar />
        <div className="flex flex-col">
          {children}
        </div>
      </div>
    </AuthGate>
  );
}
