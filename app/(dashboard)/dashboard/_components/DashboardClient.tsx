"use client"

import type { LucideIcon } from "lucide-react"
import {
  CalculatorIcon,
  FileDownIcon,
  FileTextIcon,
  WalletIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface StatTile {
  key: string
  label: string
  icon: LucideIcon
}

const STAT_TILES: StatTile[] = [
  { key: "billed", label: "Total billed", icon: WalletIcon },
  { key: "reports", label: "Reports generated", icon: FileDownIcon },
  { key: "trips", label: "Trips in range", icon: CalculatorIcon },
  { key: "orgs", label: "Organizations", icon: FileTextIcon },
]

/** Dashboard placeholder — real statistics land here later. */
export default function DashboardClient() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Usage and billing statistics across organizations.
          </p>
        </div>
        <Badge variant="outline">Under construction</Badge>
      </div>

      {/* KPI row — values are placeholders until the stats APIs land */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAT_TILES.map((tile) => {
          const Icon = tile.icon
          return (
            <Card key={tile.key}>
              <CardHeader>
                <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4" />
                </div>
                <CardTitle className="text-sm">{tile.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Value placeholder — replace with real stat values */}
                <Skeleton className="h-6 w-16" />
                <p className="mt-1 text-xs text-muted-foreground">
                  No data yet
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Chart placeholder area for future visualizations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Statistics</CardTitle>
          <CardDescription>
            Charts will appear here once the stats APIs are available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
