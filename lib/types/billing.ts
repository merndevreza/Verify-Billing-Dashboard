import type { DateRange } from "react-day-picker"

/** How trips are grouped on the bill. */
export type BillingType = "trip" | "file"

/** Backend application-status IDs forwarded to the sla-status filter, with
 *  their display labels — shared so the report's Request Details sheet
 *  renders the exact strings the Status filter stands for (must stay 6/7/8). */
export const APPLICATION_STATUS_LABELS: Record<number, string> = {
  6: "Submitted",
  7: "Partially Submitted",
  8: "Withdrawn",
}

/** Form values collected by the /bill-generation form (React Hook Form). */
export interface BillFormValues {
  dateRange: DateRange
  organizationId: string
  statuses: number[]
  billingType: BillingType
  /** General weekly holidays as JS getDay() indexes (0 = Sunday … 6 = Saturday). */
  weeklyHolidays: number[]
  /** Extra holidays picked from the calendar, local "yyyy-mm-dd". */
  extraHolidays: string[]
  /** Whether the period had one-off holidays on regular working days. */
  hasExtraHolidays: boolean
  /** Final confirmation gate — the form can't submit without it. */
  confirmed: boolean
  rates: {
    inStation: number
    outStation: number
    remote: number
  }
}

/** Payload posted to the billing calculate route handler. */
export interface CalculateBillPayload {
  dateFrom: string
  dateTill: string
  page: number
  org_id: string[]
  status?: number[]
  billingType: BillingType
  holidays: string[]
  rates: BillFormValues["rates"]
}
