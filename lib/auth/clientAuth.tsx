"use client"

import { useSession } from "next-auth/react"
import { useAppDispatch } from "@/lib/store"
import { logout as authLogout } from "@/lib/store/slices/authSlice"

export function useAuth() {
  const { data: session, status } = useSession()
  const dispatch = useAppDispatch()

  return {
    user: session?.user,
    token: session?.accessToken,
    isAuthenticated: !!session,
    isLoading: status === "loading",
    logout: () => {
      // 1. Clear local state instantly — no awaiting anything
      dispatch(authLogout())
      try {
        // Wipe the whole origin, not just this app's keys: other Barikoi
        // frontends sharing the origin (same dev port, co-deployed apps) leave
        // credentials behind under keys like `token` and `user`, and none of
        // that should survive sign-out.
        localStorage.clear()
      } catch {
        // localStorage can throw in privacy modes — never block sign-out
      }

      // 2. Leave for /login now. /api/auth-expired revokes the upstream API
      //    token server-side (a client-side fetch would need a CORS preflight
      //    this navigation cancels), clears the httpOnly NextAuth session
      //    cookie (proxy bounces still-authenticated users away from
      //    /login) and then redirects to /login.
      window.location.assign("/api/auth-expired?reason=logout")
    },
  }
}
