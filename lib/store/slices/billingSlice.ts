import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import { apiPost, clientAPI } from "@/lib/api"

// ============================================================================
// State shape
// ============================================================================

interface BillingState {
  // Organizations drive the per-org bill generation dropdown
  organizations: {
    items: any[]
    isLoaded: boolean
    isLoading: boolean
    error: string | null
  }
  // Bill calculation result
  calculation: {
    data: any | null
    isCalculating: boolean
    error: string | null
  }
}

const initialState: BillingState = {
  organizations: {
    items: [],
    isLoaded: false,
    isLoading: false,
    error: null,
  },
  calculation: {
    data: null,
    isCalculating: false,
    error: null,
  },
}

// ============================================================================
// Async Thunks
// ============================================================================

export const fetchOrganizations = createAsyncThunk(
  "billing/fetchOrganizations",
  async (token: string | undefined, { rejectWithValue }) => {
    try {
      // Direct backend call from the browser (visible in the Network tab)
      const response: any = await clientAPI.organizations.getOrganizations(token)
      return response
    } catch (error: any) {
      return rejectWithValue(error.message || "Failed to fetch organizations")
    }
  }
)

// Calls the NEW billing API (app/api/billing/calculate) — this app's own
// server-side calculation logic, not an existing backend endpoint.
export const calculateBill = createAsyncThunk(
  "billing/calculateBill",
  async (payload: Record<string, unknown> | undefined, { rejectWithValue }) => {
    try {
      return await apiPost<any>("/api/billing/calculate", payload ?? {})
    } catch (error: any) {
      return rejectWithValue(error.message || "Failed to calculate bill")
    }
  }
)

// ============================================================================
// Slice
// ============================================================================

const billingSlice = createSlice({
  name: "billing",
  initialState,
  reducers: {
    clearCalculation: (state) => {
      state.calculation.data = null
      state.calculation.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      // Organizations
      .addCase(fetchOrganizations.pending, (state) => {
        state.organizations.isLoading = true
        state.organizations.error = null
      })
      .addCase(fetchOrganizations.fulfilled, (state, action) => {
        state.organizations.isLoading = false
        state.organizations.isLoaded = true
        state.organizations.items = Array.isArray(action.payload)
          ? action.payload
          : (action.payload?.data ?? [])
      })
      .addCase(fetchOrganizations.rejected, (state, action) => {
        state.organizations.isLoading = false
        state.organizations.isLoaded = true
        state.organizations.error = action.payload as string
      })
      // Calculation
      .addCase(calculateBill.pending, (state) => {
        state.calculation.isCalculating = true
        state.calculation.error = null
      })
      .addCase(calculateBill.fulfilled, (state, action) => {
        state.calculation.isCalculating = false
        state.calculation.data = action.payload ?? null
      })
      .addCase(calculateBill.rejected, (state, action) => {
        state.calculation.isCalculating = false
        state.calculation.error = action.payload as string
      })
  },
})

export const { clearCalculation } = billingSlice.actions

export default billingSlice.reducer
