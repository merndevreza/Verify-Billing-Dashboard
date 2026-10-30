/** One row of the backend trip-status .xls export (header names as in the file). */
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
}

/** The columns appended to the report, exactly as they must appear. */
export const BILLING_COLUMN_HEADERS = [
  "Rate",
  "TAT Days",
  "TAT Extra",
  "Penalty",
  "Price After Penalty",
  "Compared Branches And Distances",
] as const

export interface BillingColumns {
  "Rate": number | null
  "TAT Days": number | null
  "TAT Extra": number | null
  "Penalty": number | null
  "Price After Penalty": number | null
  /** Audit trail: every branch compared for this trip and its road distance. */
  "Compared Branches And Distances": string | null
}

/** A trip-status row with the calculated billing columns appended. */
export interface BillingRow extends TripStatusRow, BillingColumns {}

/** Aggregated result of one billing run (also persisted as summary.json). */
export interface BillSummary {
  totalRows: number
  /** Rows with a final IN/OUT/REMOTE classification and a full bill amount. */
  billed: number
  classification: { in: number; out: number; remote: number }
  /** Rows marked ROUTE_DISTANCE_UNAVAILABLE — billing columns left empty. */
  routeUnavailable: number
  /** Rows with missing/invalid coordinates that needed routing. */
  invalidCoordinates: number
  /** Rows classified but with an unparseable Receive/Verification date. */
  tatUnavailable: number
  /** Rows whose original in_out_remote was not IN/OUT/REMOTE. */
  unclassified: number
  totalAmount: number
}
