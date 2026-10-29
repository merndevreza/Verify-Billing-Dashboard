"use client"

import { SessionProvider } from "next-auth/react"
import { ReduxProvider } from "@/lib/store"
import { Toaster } from "@/components/ui/sonner"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ReduxProvider>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </ReduxProvider>
    </SessionProvider>
  )
}
