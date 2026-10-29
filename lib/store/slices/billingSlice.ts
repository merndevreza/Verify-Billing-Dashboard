import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit"
import { apiPost, clientAPI } from "@/lib/api"
import type { TripHistoryParams } from "@/lib/api/client"

// ============================================================================
// State shape
// ============================================================================

interface ListMeta {
  currentPage: number
  lastPage: number
  perPage: number
  total: number
}

interface BillingState {
  // Organizations drive the per-org bill generation dropdown
  organizations: {
    items: any[]
    isLoaded: boolean
    isLoading: boolean
    error: string | null
  }
  // Trip history input data for the report
  tripHistory: {
    items: any[]
    meta: ListMeta | null
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
  tripHistory: {
    items: [],
    meta: null,
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

export const fetchTripHistory = createAsyncThunk(
  "billing/fetchTripHistory",
  async (
    args: { params?: TripHistoryParams; token?: string } | undefined,
    { rejectWithValue }
  ) => {
    try {
      const { params, token } = args ?? {}
      return await clientAPI.billing.getTripHistory(params, token)
    } catch (error: any) {
      return rejectWithValue(error.message || "Failed to fetch trip history")
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
    clearTripHistory: (state) => {
      state.tripHistory.items = []
      state.tripHistory.meta = null
      state.tripHistory.error = null
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
      // Trip history
      .addCase(fetchTripHistory.pending, (state) => {
        state.tripHistory.isLoading = true
        state.tripHistory.error = null
      })
      .addCase(fetchTripHistory.fulfilled, (state, action) => {
        state.tripHistory.isLoading = false
        const payload = action.payload ?? {}
        const list = Array.isArray(payload)
          ? payload
          : (payload.data ?? payload.trips ?? [])
        state.tripHistory.items = Array.isArray(list) ? list : []
        const paginator = payload.trips ?? payload
        state.tripHistory.meta =
          paginator?.current_page !== undefined
            ? {
                currentPage: paginator.current_page,
                lastPage: paginator.last_page ?? 1,
                perPage: paginator.per_page ?? 0,
                total: paginator.total ?? 0,
              }
            : null
      })
      .addCase(fetchTripHistory.rejected, (state, action) => {
        state.tripHistory.isLoading = false
        state.tripHistory.error = action.payload as string
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

export const { clearCalculation, clearTripHistory } = billingSlice.actions

export default billingSlice.reducer
