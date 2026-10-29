"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Spinner } from "@/components/ui/spinner"

interface ProtectedRouteProps {
  children: React.ReactNode
}

/**
 * Client-side session guard (safety net on top of proxy.ts): shows a spinner
 * while the session status resolves client-side instead of flashing content.
 * Unauthenticated → render nothing; proxy.ts handles the redirect.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { status } = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || status === "loading") {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (status === "unauthenticated") {
    return null
  }

  return <>{children}</>
}
