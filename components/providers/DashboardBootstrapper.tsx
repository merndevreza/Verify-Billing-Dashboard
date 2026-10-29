"use client"

import { useEffect, useRef } from "react"
import { useAppDispatch } from "@/lib/store"
import { useAuth } from "@/lib/auth/clientAuth"
import { fetchUserProfile } from "@/lib/store/slices/authSlice"

interface DashboardBootstrapperProps {
  children: React.ReactNode
}

/**
 * DashboardBootstrapper - fetches the user profile (and permissions) into
 * Redux in the background, mirroring v3's GlobalBootstrapper. NON-BLOCKING:
 * children render immediately, no loading states — authentication itself is
 * already handled by proxy.ts.
 */
export default function DashboardBootstrapper({
  children,
}: DashboardBootstrapperProps) {
  const dispatch = useAppDispatch()
  const { token, isAuthenticated, isLoading: authLoading } = useAuth()

  const hasBootstrapped = useRef(false)

  useEffect(() => {
    // Only bootstrap once per session
    if (hasBootstrapped.current) {
      return
    }

    // Wait for auth to settle (but don't block UI)
    if (authLoading) {
      return
    }

    // Only bootstrap if authenticated and the API token is in the session
    if (!isAuthenticated || !token) {
      return
    }

    hasBootstrapped.current = true
    dispatch(fetchUserProfile(token))
  }, [dispatch, isAuthenticated, token, authLoading])

  return <>{children}</>
}
