import "next-auth"
import { JWT } from "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    accessToken?: string
    vendor_id?: number
    user?: any
    permissions?: any
  }

  interface User {
    accessToken?: string
    vendor_id?: number
    user?: any
    maxAge?: number
    permissions?: any
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
    vendor_id?: number
    user?: any
    permissions?: any
  }
}
