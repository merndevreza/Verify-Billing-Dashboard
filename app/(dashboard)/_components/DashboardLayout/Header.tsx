"use client"

import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import {
  ChevronDownIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react"

import { getPageTitle } from "@/config/menu"
import { useAuth } from "@/lib/auth/clientAuth"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"

interface HeaderProps {
  /** Opens the mobile Sheet nav (below lg breakpoint). */
  onMenuClick: () => void
}

/** First letters of the first two words of the name, uppercase. */
function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("") || "?"
  )
}

/** Dashboard top bar: page title, theme toggle and account menu. */
export default function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const pageTitle = getPageTitle(pathname)
  const initials = user?.name ? getInitials(user.name) : "?"

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <MenuIcon />
      </Button>

      <h1 className="truncate text-sm font-semibold">{pageTitle}</h1>

      <div className="ml-auto flex items-center gap-1.5">
        {mounted && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        )}

        <Separator orientation="vertical" className="h-4" />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="gap-1.5 px-1.5" />
            }
          >
            <span className="sr-only">Open account menu</span>
            <Avatar className="size-6">
              <AvatarFallback className="text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[12rem] truncate md:block">
              {user?.name}
            </span>
            <ChevronDownIcon className="hidden size-3 text-muted-foreground md:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* DropdownMenuLabel renders Menu.GroupLabel in the base-ui
                style, which requires a Menu.Group ancestor. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="text-sm font-medium">{user?.name ?? "—"}</div>
                <div className="text-xs font-normal text-muted-foreground">
                  {user?.email ?? "—"}
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOutIcon className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
