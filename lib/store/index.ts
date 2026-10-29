// Store
export { default as store } from "./store"
export type { RootState, AppDispatch } from "./store"
export { useAppDispatch, useAppSelector, useAppStore } from "./store"

// Provider
export { default as ReduxProvider } from "./Provider"

// Note: Slice actions should be imported directly from their slice files
// to avoid naming conflicts (e.g., multiple 'setIsLoading' actions)
// Example: import { calculateBill } from '@/lib/store/slices/billingSlice';
