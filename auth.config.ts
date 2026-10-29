import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"
import { AUTH } from "./app.config"

// Credentials auth against the same backend as verify-admin-dashboard-v3
// (POST {AUTH.LOGIN}). The returned API token is stored in the JWT and later
// attached server-side as a Bearer token by this app's /api route handlers.
export default {
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        rememberMe: { label: "Remember Me", type: "checkbox" },
      },
      async authorize(credentials) {
        try {
          const response = await fetch(`${AUTH.LOGIN}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          })

          if (!response.ok) {
            console.error("Login failed with status:", response.status)
            return null
          }

          const contentType = response.headers.get("content-type")
          if (!contentType || !contentType.includes("application/json")) {
            return null
          }

          const data = await response.json()

          // Check both success flag and status (backend may send status instead of success)
          const isSuccess = data.success || data.status === 200
          if (isSuccess && data.data) {
            // Session expiration: 10 days if rememberMe, else 1 day
            const rememberMe = credentials.rememberMe === "true"
            const maxAge = rememberMe ? 10 * 24 * 60 * 60 : 24 * 60 * 60

            // Embed permissions in the user object so session.user carries them
            const userWithPermissions = {
              ...data.user,
              permissions: data.permissions,
            }

            return {
              accessToken: data.data,
              vendor_id: data.user?.vendor_id,
              user: userWithPermissions,
              permissions: data.permissions,
              maxAge,
            }
          }

          return null
        } catch (error) {
          console.error("Auth error:", error)
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken as string
        token.vendor_id = user.vendor_id as number
        token.user = user.user
        token.permissions = user.permissions as any
        // Set token expiration based on rememberMe
        if (user.maxAge) {
          token.exp = Math.floor(Date.now() / 1000) + (user.maxAge as number)
        }
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.vendor_id = token.vendor_id as number
      session.user = token.user
      session.permissions = token.permissions as any
      return session
    },
  },
} satisfies NextAuthConfig
