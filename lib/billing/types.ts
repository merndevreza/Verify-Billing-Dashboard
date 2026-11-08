/** One row of the backend sla-status report (field names match the retired xls export). */
export interface TripStatusRow {
  DepositId: string | number
  RefId: string | number
  VerificationTypeName: string
  VerificationStatus: string
  ContactPerson: string
  ContactPersonsDesignation: string
  OwnerNameStatus: string
  NatureOfBusiness: string
  SignBoardStatus: string
  NatureOfBusinessStatus: string
  MobileVerificationStatus: string
  Relation: string
  Comments: string
  Remarks: string
  Latitude: string | number
  Longitude: string | number
  VerificationDateTime: string | number
  ResidenceType: string
  StayOfDuration: string
  Address: string
  "Receive Date": string | number
  InsideDhakaMetro: string
  AddressApproachStatus: string
  District: string
  Thana: string
  in_out_remote: string
  ApplicationStatus: string
  SubmissionDateTime: string | number
}

/**
 * The columns appended after the base columns, exactly as they must appear.
 * "Submission Date" is not here — the report places it mid-report, side by
 * side with the other date columns (see DATE_COLUMNS in report.ts).
 */
export const BILLING_COLUMN_HEADERS = [
  "Rate",
  "TAT Days",
  "TAT Extra",
  "Penalty",
  "Price After Penalty",
  "Compared Branches And Distances",
  "Attention Needed",
] as const

export interface BillingColumns {
  /**
   * Billable verdict derived from the verification outcome: "Yes" when the
   * row bills, null when it does not (those rows get "Attention Needed"
   * instead). The report places this column right after
   * "AddressApproachStatus".
   */
  "isBill": "Yes" | null
  /** Excel serial (date + time), rendered like the other date columns. */
  "Submission Date": number | null
  "Rate": number | null
  "TAT Days": number | null
  "TAT Extra": number | null
  "Penalty": number | null
  "Price After Penalty": number | null
  /**
   * Audit trail: the boundary/isochrone verdict for this trip's end point —
   * the city/district boundary hit, every branch isochrone containing it
   * with its category ("Gulshan Branch [in]"), or NO_ISOCHRONE_MATCH.
   */
  "Compared Branches And Distances": string | null
  /**
   * Manual-check flag: "Yes" on rows whose billable verdict comes from a
   * Comments override (see billingFlag in calculate.ts) — the report
   * highlights those rows yellow.
   */
  "Attention Needed": string | null
}

/** A trip-status row with the calculated billing columns appended. */
export interface BillingRow extends TripStatusRow, BillingColumns {}

/** Aggregated result of one billing run (also persisted as summary.json). */
export interface BillSummary {
  totalRows: number
  /** Rows with a final IN/OUT/REMOTE classification and a full bill amount. */
  billed: number
  classification: { in: number; out: number; remote: number }
  /** Rows with missing/invalid coordinates that needed containment. */
  invalidCoordinates: number
  /** Rows classified but with an unparseable Receive/Verification date. */
  tatUnavailable: number
  /**
   * Rows delivered with a null SubmissionDateTime: the calculation is
   * skipped entirely for them (left unbilled, backend classification
   * untouched) since TAT is not computable.
   */
  submissionMissing: number
  /**
   * Rows whose original in_out_remote was not IN/OUT/REMOTE, plus claimed-IN
   * rows rejected by the Dhaka boundary check when no isochrone dataset
   * exists to reclassify them with (left unbilled, reason in the audit column).
   */
  unclassified: number
  totalAmount: number
}
