import type { DateRange } from "react-day-picker"

/** How trips are grouped on the bill. */
export type BillingType = "trip" | "location"

/** Form values collected by the /bill-generation form (React Hook Form). */
export type ActionDateType = "START_DATE" | "END_DATE"

export interface BillFormValues {
  dateRange: DateRange
  organizationId: string
  statuses: number[]
  /** "" = unselected; kept controlled (never undefined) for the Select component. */
  action_date_type?: ActionDateType | ""
  billingType: BillingType
  /** General weekly holidays as JS getDay() indexes (0 = Sunday … 6 = Saturday). */
  weeklyHolidays: number[]
  /** Extra holidays picked from the calendar, local "yyyy-mm-dd". */
  extraHolidays: string[]
  rates: {
    inStation: number
    outStation: number
    remote: number
  }
  /** SLA-breach penalty percentage per delayed day. */
  penalties: {
    day1: number
    day2: number
    day3: number
    day4: number
    day5: number
    day6: number
    day7: number
  }
}

/** Payload posted to the billing calculate route handler. */
export interface CalculateBillPayload {
  dateFrom: string
  dateTill: string
  page: number
  org_id: string[]
  status?: number[]
  action_date_type?: ActionDateType
  billingType: BillingType
  holidays: string[]
  rates: BillFormValues["rates"]
  penalties: BillFormValues["penalties"]
}
