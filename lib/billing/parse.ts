import type { TripStatusRow } from "./types"

/**
 * Columns the calculation depends on; a missing one means the response is not
 * what we expect. Checked against the RAW rows before normalization so a
 * backend field rename fails loudly instead of silently billing on blanks.
 */
export const REQUIRED_COLUMNS = [
  "DepositId",
  "RefId",
  "Latitude",
  "Longitude",
  "VerificationDateTime",
  "Receive Date",
  "District",
  "Address",
  "in_out_remote",
  "api_submission_time",
] as const

/** Column order preserved into the report (matches the retired xls export). */
export const TRIP_STATUS_COLUMNS = [
  "DepositId",
  "RefId",
  "VerificationTypeName",
  "VerificationStatus",
  "ContactPerson",
  "ContactPersonsDesignation",
  "OwnerNameStatus",
  "NatureOfBusiness",
  "SignBoardStatus",
  "NatureOfBusinessStatus",
  "MobileVerificationStatus",
  "Relation",
  "Comments",
  "Remarks",
  "Latitude",
  "Longitude",
  "VerificationDateTime",
  "ResidenceType",
  "StayOfDuration",
  "Address",
  "Receive Date",
  "InsideDhakaMetro",
  "AddressApproachStatus",
  "District",
  "Thana",
  "in_out_remote",
  "ApplicationStatus",
  "api_submission_time",
] as const

export interface ParsedTripFile {
  rows: TripStatusRow[]
  /**
   * Excel number format per date column, applied to the output file. The
   * sla-status JSON carries no cell formats — leave empty and the report
   * falls back to its DEFAULT_DATE_FORMAT.
   */
  dateFormats: Partial<Record<"VerificationDateTime" | "Receive Date", string>>
}

/**
 * Normalize the backend sla-status JSON response into row objects.
 *
 * Dates arrive as Excel serial numbers (e.g. 46327.675) and stay numeric so
 * they round-trip into the output file with a date number format. Nulls
 * (e.g. Thana) become "" and columns are emitted in TRIP_STATUS_COLUMNS
 * order so the report keeps a stable column order.
 */
export function parseSlaStatusResponse(payload: unknown): ParsedTripFile {
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data: unknown }).data
      : undefined
  if (!Array.isArray(data)) {
    throw new Error("The sla-status response did not include a data array")
  }

  if (data.length > 0) {
    const first =
      typeof data[0] === "object" && data[0] !== null
        ? (data[0] as Record<string, unknown>)
        : {}
    const missing = REQUIRED_COLUMNS.filter((c) => !(c in first))
    if (missing.length > 0) {
      throw new Error(
        `The sla-status response is missing expected column(s): ${missing.join(", ")}`
      )
    }
  }

  const rows = data.map((raw): TripStatusRow => {
    const source =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)
        : {}
    const row: Record<string, unknown> = {}
    for (const column of TRIP_STATUS_COLUMNS) {
      const value = source[column]
      row[column] = value === null || value === undefined ? "" : value
    }
    // Every TripStatusRow key was just set; the per-key types are wider than
    // the runtime contract needs, so the cast is safe here.
    return row as unknown as TripStatusRow
  })

  return { rows, dateFormats: {} }
}
