import DashboardLayout from "./_components/DashboardLayout"
import DashboardBootstrapper from "@/components/providers/DashboardBootstrapper"
import ProtectedRoute from "@/components/auth/ProtectedRoute"

// proxy.ts already guarantees a session server-side; these two wrappers add
// the client-side safety net (spinner while the session resolves) and the
// background profile/permissions bootstrap into Redux.
export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ProtectedRoute>
      <DashboardBootstrapper>
        <DashboardLayout>{children}</DashboardLayout>
      </DashboardBootstrapper>
    </ProtectedRoute>
  )
}
