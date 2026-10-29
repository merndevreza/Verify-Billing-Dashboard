import type { LucideIcon } from "lucide-react"
import { CalculatorIcon, LayoutDashboardIcon } from "lucide-react"

export interface MenuItem {
  key: string
  label: string
  icon: LucideIcon
  link: string
}

// Sidebar menu. Add new bill-related modules here (e.g. reports, history).
export const MENU_ITEMS: MenuItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    link: "/dashboard",
  },
  {
    key: "bill-generation",
    label: "Bill Generation",
    icon: CalculatorIcon,
    link: "/bill-generation",
  },
]

/** Page title for the current pathname, from the menu config. */
export function getPageTitle(pathname: string): string {
  const match = MENU_ITEMS.find(
    (item) => pathname === item.link || pathname.startsWith(item.link + "/")
  )
  return match?.label ?? "Bill Generation"
}
