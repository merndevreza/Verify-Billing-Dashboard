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

/** A trip-status row plus the values this app calculates. */
export interface BilledRow extends TripStatusRow {
  /** Normalised in_out_remote: "IN" | "OUT" | "REMOTE" | "" (unrecognised). */
  zone: "IN" | "OUT" | "REMOTE" | ""
  /** Rate applied to this row (0 when the zone is unrecognised). */
  amount: number
}

export interface BillSummary {
  totalRows: number
  inStation: { count: number; amount: number }
  outStation: { count: number; amount: number }
  remote: { count: number; amount: number }
  /** Rows whose in_out_remote was not IN / OUT / REMOTE — billed 0. */
  unmatched: number
  totalAmount: number
}