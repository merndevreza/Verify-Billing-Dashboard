"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalculatorIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import { MENU_ITEMS } from "@/config/menu"
import { APP_VERSION } from "@/config/version"
import { Separator } from "@/components/ui/separator"

interface SidebarContentProps {
  /** Close the mobile Sheet after navigating. */
  onNavigate?: () => void
}

/** Brand block + nav, shared by the desktop sidebar and the mobile Sheet. */
export default function SidebarContent({ onNavigate }: SidebarContentProps) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <CalculatorIcon className="size-4" />
        </div>
        <span className="text-sm font-semibold">Verify Billing</span>
        <span className="ml-auto font-mono text-[0.625rem] text-muted-foreground">
          v{APP_VERSION}
        </span>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {MENU_ITEMS.map((item) => {
          const isActive =
            pathname === item.link || pathname.startsWith(item.link + "/")
          const Icon = item.icon
          return (
            <Link
              key={item.key}
              href={item.link}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs/relaxed font-medium text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground",
                isActive && "bg-muted text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          )
        })}
        {MENU_ITEMS.length === 0 && (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            No pages yet
          </p>
        )}
      </nav>
    </div>
  )
}
