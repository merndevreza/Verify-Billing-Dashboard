import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import NextAuth from "next-auth"
import authConfig from "./auth.config"

const { auth } = NextAuth(authConfig)

// Routes that require authentication ("/" is handled separately below —
// it must never join this list, since every path startsWith("/") and /login
// would become "protected", causing a redirect loop).
const protectedRoutes = ["/dashboard", "/bill-generation"]

// Only public routes
const publicRoutes = ["/login"]

function matchesRoute(path: string, route: string): boolean {
  return path === route || path.startsWith(route + "/")
}

export default auth((req: NextRequest & { auth: any }) => {
  const path = req.nextUrl.pathname

  const isProtectedRoute =
    path === "/" || protectedRoutes.some((route) => matchesRoute(path, route))
  const isPublicRoute = publicRoutes.some((route) => matchesRoute(path, route))

  const session = req.auth

  // Redirect unauthenticated users to login
  if (isProtectedRoute && !session?.user) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  // Redirect authenticated users away from public routes
  if (isPublicRoute && session?.user) {
    return NextResponse.redirect(new URL("/bill-generation", req.url))
  }

  return NextResponse.next()
})

// Routes proxy should not run on
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|monitoring).*)"],
}
