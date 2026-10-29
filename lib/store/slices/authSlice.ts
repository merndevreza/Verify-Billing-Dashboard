import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import { clientAPI } from "@/lib/api"
import type {
  AuthUserResponse,
  UserData,
  PermissionCategory,
} from "@/lib/types/auth"

interface AuthState {
  user: UserData | null
  permissions: PermissionCategory | null
  roles: any[] | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  permissionsLoaded: boolean
  permissionsError: string | null
}

const initialState: AuthState = {
  user: null,
  permissions: null,
  roles: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  permissionsLoaded: false,
  permissionsError: null,
}

// Async Thunks
export const fetchUserProfile = createAsyncThunk(
  "auth/fetchUserProfile",
  async (token: string, { rejectWithValue }) => {
    try {
      // Direct backend call from the browser (visible in the Network tab)
      const response = (await clientAPI.auth.getUser(token)) as AuthUserResponse
      return response
    } catch (error: any) {
      return rejectWithValue(error.message || "Failed to fetch user profile")
    }
  }
)

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<UserData | null>) => {
      state.user = action.payload
    },
    setPermissions: (
      state,
      action: PayloadAction<PermissionCategory | null>
    ) => {
      state.permissions = action.payload
    },
    setRoles: (state, action: PayloadAction<any[] | null>) => {
      state.roles = action.payload
    },
    setIsAuthenticated: (state, action: PayloadAction<boolean>) => {
      state.isAuthenticated = action.payload
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload
    },
    clearError: (state) => {
      state.error = null
    },
    logout: (state) => {
      state.user = null
      state.permissions = null
      state.roles = null
      state.isAuthenticated = false
      state.error = null
      state.permissionsLoaded = false
      state.permissionsError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUserProfile.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload?.data || null
        state.permissions = action.payload?.permissions || null
        state.roles = action.payload?.roles || null
        state.isAuthenticated = true
        state.permissionsLoaded = true
        state.permissionsError = null
      })
      .addCase(fetchUserProfile.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload as string
        state.isAuthenticated = false
        state.permissionsLoaded = true
        state.permissionsError = action.payload as string
      })
  },
})

export const {
  setUser,
  setPermissions,
  setRoles,
  setIsAuthenticated,
  setIsLoading: setAuthLoading,
  setError: setAuthError,
  clearError: clearAuthError,
  logout,
} = authSlice.actions

export default authSlice.reducer
