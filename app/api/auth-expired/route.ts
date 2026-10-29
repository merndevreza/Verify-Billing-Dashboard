import { NextResponse } from "next/server"
import { auth, signOut } from "@/auth"
import { AUTH } from "@/app.config"

/**
 * Clears a stale NextAuth session and redirects to /login.
 *
 * Manual sign-outs (?reason=logout) also revoke the upstream API token. That
 * call happens here, server-side: the API origin differs from the dashboard,
 * so a browser-side fetch would need a CORS preflight that the immediate
 * navigation to this route cancels. Revoking an already-expired token is
 * pointless, so this only runs for manual sign-outs.
 */
export async function GET(req: Request) {
  const isManualLogout =
    new URL(req.url).searchParams.get("reason") === "logout"

  if (isManualLogout) {
    await revokeUpstreamToken()
  }

  await signOut({ redirect: false })
  const params = new URLSearchParams()
  if (!isManualLogout) {
    params.set("expired", "1")
  }
  const query = params.toString()

  // Relative Location on purpose: req.url is rebuilt from the Host header,
  // which production proxies may replace with an internal hostname.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `/login${query ? `?${query}` : ""}` },
  })
}

/**
 * POSTs the session Bearer token to the backend /logout endpoint so the
 * access token is revoked server-side. Bounded by a short timeout and
 * failure-tolerant: cookie revocation above is what actually ends the
 * session, so an unreachable backend must never block sign-out.
 */
async function revokeUpstreamToken() {
  const session = await auth()
  const token = session?.accessToken
  if (!token || !AUTH.LOGOUT) return

  try {
    await fetch(AUTH.LOGOUT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })
  } catch (error) {
    console.error(
      "[auth-expired] Upstream logout failed:",
      (error as Error).message
    )
  }
}
