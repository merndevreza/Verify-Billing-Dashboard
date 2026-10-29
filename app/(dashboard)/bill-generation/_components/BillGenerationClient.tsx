"use client"

import type { LucideIcon } from "lucide-react"
import { CalculatorIcon, FileDownIcon, HistoryIcon } from "lucide-react"

import { useAppDispatch, useAppSelector } from "@/lib/store"
import { useAuth } from "@/lib/auth/clientAuth"
import { fetchOrganizations } from "@/lib/store/slices/billingSlice"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

interface PlannedFeature {
  icon: LucideIcon
  title: string
  description: string
}

const PLANNED_FEATURES: PlannedFeature[] = [
  {
    icon: CalculatorIcon,
    title: "Calculate billing",
    description:
      "Run billing calculations for a selected organization and date range.",
  },
  {
    icon: FileDownIcon,
    title: "Generate CSV report",
    description:
      "Generate and download the per-organization CSV billing report.",
  },
  {
    icon: HistoryIcon,
    title: "Trip history",
    description: "Review trip history data used as billing input.",
  },
]

/** Placeholder page content for the future bill generation module. */
export default function BillGenerationClient() {
  const dispatch = useAppDispatch()
  const { token } = useAuth()
  const { items, isLoading, error } = useAppSelector(
    (s) => s.billing.organizations
  )
  const count = items.length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Bill Generation</h2>
        <p className="text-sm text-muted-foreground">
          Calculate billing and generate CSV reports per organization. This
          module is under construction.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API connectivity check</CardTitle>
          <CardDescription>
            Calls the backend organizations API directly from the browser
            (Bearer token from the session) — visible in the Network tab
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => dispatch(fetchOrganizations(token))}
            disabled={isLoading || !token}
          >
            {isLoading && <Spinner className="size-3.5" />}
            {isLoading ? "Loading…" : "Load organizations"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!isLoading && !error && count > 0 && (
            <p className="text-xs text-muted-foreground">
              {count} organizations loaded
            </p>
          )}
          {!isLoading && !error && count === 0 && (
            <p className="text-xs text-muted-foreground">
              No organizations found
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {PLANNED_FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <Card key={feature.title}>
              <CardHeader>
                <div className="flex size-8 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-4" />
                </div>
                <CardTitle className="text-sm">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {feature.description}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
