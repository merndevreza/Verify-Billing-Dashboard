import type { Metadata } from "next"
import BillGenerationClient from "./_components/BillGenerationClient"

export const metadata: Metadata = { title: "Bill Generation" }

export default function BillGenerationPage() {
  return <BillGenerationClient />
}
