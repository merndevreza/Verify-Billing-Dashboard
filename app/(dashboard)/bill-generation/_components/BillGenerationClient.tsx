"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { addDays } from "date-fns"
import { CalendarIcon, XIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { toast } from "sonner"

import { useAppDispatch, useAppSelector } from "@/lib/store"
import { useAuth } from "@/lib/auth/clientAuth"
import { fetchOrganizations } from "@/lib/store/slices/billingSlice"
import type { BillFormValues, CalculateBillPayload } from "@/lib/types/billing"
import {
  eachDateInRange,
  toISODate,
  formatShortDate,
  formatShortWeekday,
  formatFullDate,
} from "@/lib/utils/date"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import DateRangeField from "./DateRangeField"
import { BillingReportLoadingDialog } from "./BillingReportLoadingDialog"

const WEEKDAYS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
]

// reports table, application header, and filter dropdowns.
// Keys are display order; `value` is the backend application-status ID
// forwarded to the sla-status filter, so it must stay 6/7/8.
const APPLICATION_STATUS_MAP: Record<number, { label: string; value: number }> = {
  1: { label: 'Submitted', value: 6 },
  2: { label: 'Partially Submitted', value: 7 },
  3: { label: 'Withdrawn', value: 8 },
};
// Only this organization is billable for now; the rest render disabled.
const ENABLED_ORG_UUID = "79e1788b-4b40-48d3-ab51-25171779703d" // Brac Bank PLC

// Weekly holidays are auto-detected across the billing period plus this many
// days before its start (the bill's lookback window).
const HOLIDAY_LOOKBACK_DAYS = 30

const DEFAULT_VALUES: BillFormValues = {
  dateRange: { from: undefined, to: undefined },
  organizationId: ENABLED_ORG_UUID,
  statuses: [6,8],
  action_date_type: "END_DATE",
  billingType: "trip",
  weeklyHolidays: [5, 6], // Friday + Saturday
  extraHolidays: [],
  hasExtraHolidays: false,
  confirmed: false,
  rates: { inStation: 150, outStation: 200, remote: 685 },
}

// Loading dialog keeps showing its completed state at least this long after
// the response arrives, before closing.
const DONE_DISPLAY_MS = 3000

export default function BillGenerationClient() {
  const dispatch = useAppDispatch()
  const { token } = useAuth()
  const { user } = useAppSelector((s) => s.auth)
  const { items: orgItems, isLoading: orgsLoading } = useAppSelector(
    (s) => s.billing.organizations
  )
  const orgs: any[] = (user?.organizations?.length ? user.organizations : orgItems)

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BillFormValues>({ defaultValues: DEFAULT_VALUES })
  const [isFinishing, setIsFinishing] = useState(false)
  // Reveals the ✕ remove buttons on auto-detected holiday chips (UI-only;
  // removing still unchecks that weekday).
  const [allowHolidayRemoval, setAllowHolidayRemoval] = useState(false)

  useEffect(() => {
    if (token && !user?.organizations?.length) dispatch(fetchOrganizations(token))
  }, [dispatch, token, user?.organizations])

  const dateRange = watch("dateRange")
  const weeklyHolidays = watch("weeklyHolidays")
  const extraHolidays = watch("extraHolidays")
  const hasExtraHolidays = watch("hasExtraHolidays")
  const confirmed = watch("confirmed")

  // Dates from (period start − 30 days) through period end that fall on
  // weekly holidays — the bill's lookback window.
  const weeklyHolidayDates = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return []
    return eachDateInRange({
      from: addDays(dateRange.from, -HOLIDAY_LOOKBACK_DAYS),
      to: dateRange.to,
    })
      .filter((d) => weeklyHolidays.includes(d.getDay()))
      .map(toISODate)
  }, [dateRange, weeklyHolidays])

  function toggleWeeklyHoliday(day: number, checked: boolean) {
    const current = weeklyHolidays
    setValue(
      "weeklyHolidays",
      checked ? [...current, day] : current.filter((d) => d !== day)
    )
  }

  // Opting out also clears any picked extra holidays so stale dates can't
  // reach the payload.
  function toggleExtraHolidays(checked: boolean) {
    setValue("hasExtraHolidays", checked)
    if (!checked) setValue("extraHolidays", [])
  }

  // All selected holiday dates (weekly-derived + extra) for calendar highlighting
  const allHolidayDates = useMemo(() => {
    const extras = extraHolidays.map((iso) => new Date(`${iso}T00:00:00`))
    const weekly = weeklyHolidayDates.map((iso) => new Date(`${iso}T00:00:00`))
    return [...weekly, ...extras]
  }, [weeklyHolidayDates, extraHolidays])

  function addExtraHoliday(date: Date | undefined) {
    if (!date) return
    const iso = toISODate(date)
    if (!extraHolidays.includes(iso) && !weeklyHolidayDates.includes(iso)) {
      setValue("extraHolidays", [...extraHolidays, iso])
    }
  }

  function removeExtraHoliday(iso: string) {
    setValue(
      "extraHolidays",
      extraHolidays.filter((d) => d !== iso)
    )
  }

  function removeWeeklyHolidayDate(iso: string) {
    // Find which weekday this date is and uncheck it
    const day = new Date(`${iso}T00:00:00`).getDay()
    setValue(
      "weeklyHolidays",
      weeklyHolidays.filter((d) => d !== day)
    )
  }

  async function onSubmit(data: BillFormValues) {
    const allHolidays = [...weeklyHolidayDates, ...data.extraHolidays]
    const payload: CalculateBillPayload = {
      dateFrom: toISODate(data.dateRange.from!),
      dateTill: toISODate(data.dateRange.to!),
      page: 1,
      org_id: [data.organizationId],
      billingType: data.billingType,
      holidays: allHolidays,
      rates: data.rates,
    }
    // Optional filters — omitted entirely so the backend call runs unfiltered.
    if (data.statuses.length > 0) payload.status = data.statuses
    if (data.action_date_type) payload.action_date_type = data.action_date_type

    const response = await fetch("/api/billing/calculate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    // Error responses are JSON; success streams the generated .xlsx back.
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || contentType.includes("application/json")) {
      const result = await response.json().catch(() => null)
      toast.error(result?.message ?? "Bill calculation failed")
      return
    }

    const blob = await response.blob()
    const disposition = response.headers.get("content-disposition") ?? ""
    const fileName =
      /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "Billing_Report.xlsx"
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)

    const totalAmount = response.headers.get("X-Total-Amount")
    const billedTrips = response.headers.get("X-Billed-Trips")
    toast.success(
      totalAmount
        ? `Report downloaded — Tk ${Number(totalAmount).toLocaleString("en-IN")}${billedTrips ? ` (${billedTrips} billed trips)` : ""}`
        : "Billing report downloaded"
    )

    // Show the dialog's completed state briefly, then close.
    setIsFinishing(true)
    await new Promise((resolve) => setTimeout(resolve, DONE_DISPLAY_MS))
    setIsFinishing(false)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Bill Generation</h2> 
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* ── Date Range ── */}
        <Card>
          <CardHeader>
            <CardTitle>Billing Period</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label>
              Date Range <span className="text-destructive">*</span>
            </Label>
            <Controller
              control={control}
              name="dateRange"
              rules={{
                validate: (v) =>
                  !!(v?.from && v?.to) || "Please select a date range",
              }}
              render={({ field }) => (
                <DateRangeField
                  value={field.value as DateRange}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.dateRange && (
              <p className="text-xs text-destructive">
                {errors.dateRange.message as string}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Organization & Billing Type ── */}
        <Card>
          <CardHeader>
            <CardTitle>Organization & Billing Type</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="org">
                Organization <span className="text-destructive">*</span>
              </Label>
              <Controller
                control={control}
                name="organizationId"
                rules={{ required: "Please select an organization" }}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={orgs.map((o: any) => ({ value: o.uuid, label: o.name }))}
                  >
                    <SelectTrigger className="w-full" id="org">
                      <SelectValue placeholder={orgsLoading ? "Loading…" : "Select organization"} />
                    </SelectTrigger>
                    <SelectContent>
                      {orgsLoading && (
                        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                          <Spinner className="size-3" />
                          Loading…
                        </div>
                      )}
                      {orgs.map((org: any) => (
                        <SelectItem
                          key={org.uuid}
                          value={org.uuid}
                          disabled={org.uuid !== ENABLED_ORG_UUID}
                        >
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.organizationId && (
                <p className="text-xs text-destructive">
                  {errors.organizationId.message}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>Status</Label>
              <Controller
                control={control}
                name="statuses"
                render={({ field }) => (
                  <Select
                    multiple
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All statuses">
                        {(val: number[]) =>
                          val.length === 0
                            ? "All statuses"
                            : val.length === 1
                              ? Object.values(APPLICATION_STATUS_MAP).find((opt) => opt.value === val[0])?.label
                              : `${val.length} selected`
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(APPLICATION_STATUS_MAP).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="action_date_type">Sort By</Label>
              <Controller
                control={control}
                name="action_date_type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={[{ value: "START_DATE", label: "Start Date" }, { value: "END_DATE", label: "End Date" }]}
                  >
                    <SelectTrigger className="w-full" id="action_date_type">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="START_DATE">Start Date</SelectItem>
                      <SelectItem value="END_DATE">End Date</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="billingType">Billing Type</Label>
              <Controller
                control={control}
                name="billingType"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={[{ value: "trip", label: "Trip wise" }, { value: "file", label: "File wise" }]}
                  >
                    <SelectTrigger className="w-full" id="billingType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trip">Trip wise</SelectItem>
                      <SelectItem value="file" disabled>File wise</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Holidays ── */}
        <Card>
          <CardHeader>
            <CardTitle>Holidays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Auto-detection window — highlighted so the holiday scope is explicit */}
            {dateRange?.from && dateRange?.to && (
              <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs">
                Weekly holidays are auto-detected from{" "}
                <span className="font-medium">
                  {formatFullDate(addDays(dateRange.from, -HOLIDAY_LOOKBACK_DAYS))}
                </span>{" "}
                to{" "}
                <span className="font-medium">
                  {formatFullDate(dateRange.to)}
                </span>{" "}
                — the 30 days before the billing period plus the period itself.
              </div>
            )}

            {/* Weekly holidays */}
            <div className="grid gap-2">
              <Label>Weekly Holidays</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((day) => (
                  <label
                    key={day.value}
                    className="flex cursor-pointer items-center gap-1.5 text-xs"
                  >
                    <Checkbox
                      checked={weeklyHolidays.includes(day.value)}
                      onCheckedChange={(checked) =>
                        toggleWeeklyHoliday(day.value, Boolean(checked))
                      }
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Detected holiday chips — weekly (muted) + extra (amber) */}
            {(weeklyHolidayDates.length > 0 ||
              (hasExtraHolidays && extraHolidays.length > 0)) && (
              <div className="grid gap-1.5">
                <p className="text-xs text-muted-foreground">
                  {weeklyHolidayDates.length +
                    (hasExtraHolidays ? extraHolidays.length : 0)}{" "}
                  holiday date
                  {weeklyHolidayDates.length +
                    (hasExtraHolidays ? extraHolidays.length : 0) === 1
                    ? ""
                    : "s"}{" "}
                  detected:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {weeklyHolidayDates.map((iso) => (
                    <span
                      key={iso}
                      className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                    >
                      {formatShortWeekday(iso)}, {formatShortDate(iso)}
                      {allowHolidayRemoval && (
                        <button
                          type="button"
                          onClick={() => removeWeeklyHolidayDate(iso)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${iso}`}
                        >
                          <XIcon className="size-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {hasExtraHolidays &&
                    extraHolidays.map((iso) => (
                    <span
                      key={iso}
                      className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    >
                      {formatShortWeekday(iso)}, {formatShortDate(iso)}
                      <button
                        type="button"
                        onClick={() => removeExtraHoliday(iso)}
                        className="opacity-60 hover:opacity-100"
                        aria-label={`Remove ${iso}`}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Extra holidays — opt-in via checkbox */}
            <div className="grid gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                  checked={Boolean(hasExtraHolidays)}
                  onCheckedChange={(checked) =>
                    toggleExtraHolidays(Boolean(checked))
                  }
                />
                Add Extra Holiday
              </label>
              {hasExtraHolidays && (
                <> 
                  <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className="w-fit justify-start font-normal"
                    />
                  }
                >
                  <CalendarIcon className="size-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Pick a date</span>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    onSelect={addExtraHoliday}
                    modifiers={{ highlighted: allHolidayDates }}
                    modifiersClassNames={{
                      highlighted:
                        "bg-primary/20 text-primary font-medium rounded-md",
                    }}
                    disabled={(date) =>
                      extraHolidays.includes(toISODate(date)) ||
                      weeklyHolidayDates.includes(toISODate(date))
                    }
                  />
                </PopoverContent>
              </Popover>
                </>
              )}

              {/* 2) Remove detected holidays → show ✕ on the date chips */}
              <div className="grid gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={allowHolidayRemoval}
                    onCheckedChange={(checked) =>
                      setAllowHolidayRemoval(Boolean(checked))
                    }
                  />
                  Any holiday that fell on a working day
                </label> 
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Trip Rates ── */}
        <Card>
          <CardHeader>
            <CardTitle>Trip Rates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { key: "inStation", label: "In Station" },
                { key: "outStation", label: "Out Station" },
                { key: "remote", label: "Remote" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={`rate-${key}`}>
                  {label} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`rate-${key}`}
                  type="number"
                  min={0}
                  {...register(`rates.${key}`, {
                    required: "Required",
                    min: { value: 0, message: "Must be ≥ 0" },
                    valueAsNumber: true,
                  })}
                  aria-invalid={!!errors.rates?.[key]}
                />
                {errors.rates?.[key] && (
                  <p className="text-xs text-destructive">
                    {errors.rates[key]?.message}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Final confirmation ── */}
        <Controller
          control={control}
          name="confirmed"
          rules={{
            validate: (v) =>
              v || "Please review and confirm everything is correct",
          }}
          render={({ field }) => (
            <div className="space-y-1">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
                <Checkbox
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                I confirm all the details above are correct
              </label>
              {errors.confirmed && (
                <p className="text-xs text-destructive">
                  {errors.confirmed.message}
                </p>
              )}
            </div>
          )}
        />

        <div className="flex justify-end">
          <Button
            type="submit"
            size="lg"
            disabled={isSubmitting || !confirmed}
          >
            {isSubmitting ? (
              <>
                <Spinner className="size-3.5" />
                Generating…
              </>
            ) : (
              "Generate Bill"
            )}
          </Button>
        </div>
      </form>

      {/* Generation can take 1–2 minutes on large reports — modal + disabled
          submit keep the user from re-submitting or navigating away. */}
      <BillingReportLoadingDialog
        open={isSubmitting}
        phase={isFinishing ? "done" : "running"}
        days={
          dateRange?.from && dateRange?.to
            ? eachDateInRange(dateRange).length
            : 1
        }
      />
    </div>
  )
}
