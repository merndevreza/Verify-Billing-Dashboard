import { redirect } from "next/navigation"

// Protected by proxy.ts: unauthenticated users are bounced to /login before
// this renders; authenticated users land on the first module.
export default function Page() {
  redirect("/bill-generation")
}
