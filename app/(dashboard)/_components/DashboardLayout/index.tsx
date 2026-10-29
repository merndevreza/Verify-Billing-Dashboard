"use client"

import { useState } from "react"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"

import Header from "./Header"
import SidebarContent from "./Sidebar"

interface DashboardLayoutProps {
  children: React.ReactNode
}

/**
 * Dashboard shell: fixed desktop sidebar (lg+), mobile Sheet nav,
 * sticky header and the scrollable content column.
 */
export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-svh w-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 border-r bg-sidebar lg:flex lg:flex-col">
        <SidebarContent />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-56 gap-0 p-0"
          showCloseButton={true}
        >
          <SheetTitle className="sr-only">Verify Billing navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Sidebar navigation
          </SheetDescription>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
        <Header onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
