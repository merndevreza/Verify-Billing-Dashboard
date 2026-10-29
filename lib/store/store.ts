import { configureStore, type EnhancedStore } from "@reduxjs/toolkit"
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux"

// Import Reducers
import authReducer from "./slices/authSlice"
import billingReducer from "./slices/billingSlice"

// Create the rootReducer
const rootReducer = {
  auth: authReducer,
  billing: billingReducer,
}

// Create a temporary store to infer RootState type
const tempStore = configureStore({
  reducer: rootReducer as any, // Type assertion to avoid strict reducer type checking
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
})

// Infer the `RootState` and `AppDispatch` types from the temporary store
export type RootState = ReturnType<typeof tempStore.getState>
export type AppDispatch = typeof tempStore.dispatch

// Function to create a new store instance (used for SSR)
export function makeStore(
  preloadedState?: Partial<RootState>
): EnhancedStore<RootState> {
  return configureStore({
    reducer: rootReducer as any, // Type assertion to avoid strict reducer type checking
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
    devTools: process.env.NODE_ENV !== "production",
  })
}

// Configure default Redux Store (for client-side)
const store: EnhancedStore<RootState> = makeStore()

// Export typed hooks instead of plain useDispatch/useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppStore = () => store

export default store
