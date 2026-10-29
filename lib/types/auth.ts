// Pragmatic auth types — the backend response shape is loosely typed for
// rapid development, mirroring verify-admin-dashboard-v3.

export interface UserData {
  id: number
  name: string
  email: string
  vendor_id?: number
  [key: string]: any
}

export type PermissionCategory = any

export interface AuthUserResponse {
  data: UserData
  permissions?: PermissionCategory
  roles?: any[]
}
