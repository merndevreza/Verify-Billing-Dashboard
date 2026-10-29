import type { BilledRow, BillSummary, TripStatusRow } from "./types"

export interface Rates {
  inStation: number
  outStation: number
  remote: number
}

function normaliseZone(value: unknown): BilledRow["zone"] {
  const v = String(value ?? "")
    .trim()
    .toUpperCase()
  return v === "IN" || v === "OUT" || v === "REMOTE" ? v : ""
}

/** Set each row's amount from its in_out_remote value: IN → inStation, OUT → outStation, REMOTE → remote. */
export function applyRates(
  rows: TripStatusRow[],
  rates: Rates
): { rows: BilledRow[]; summary: BillSummary } {
  const summary: BillSummary = {
    totalRows: rows.length,
    inStation: { count: 0, amount: 0 },
    outStation: { count: 0, amount: 0 },
    remote: { count: 0, amount: 0 },
    unmatched: 0,
    totalAmount: 0,
  }

  const billed = rows.map((row): BilledRow => {
    const zone = normaliseZone(row.in_out_remote)
    let amount = 0
    if (zone === "IN") {
      amount = rates.inStation
      summary.inStation.count++
      summary.inStation.amount += amount
    } else if (zone === "OUT") {
      amount = rates.outStation
      summary.outStation.count++
      summary.outStation.amount += amount
    } else if (zone === "REMOTE") {
      amount = rates.remote
      summary.remote.count++
      summary.remote.amount += amount
    } else {
      summary.unmatched++
    }
    summary.totalAmount += amount
    return { ...row, zone, amount }
  })

  return { rows: billed, summary }
}