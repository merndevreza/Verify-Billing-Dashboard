"use client"

import { useEffect, useMemo } from "react"
import { useForm, Controller } from "react-hook-form"
import { CalendarIcon, XIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { useAppDispatch, useAppSelector } from "@/lib/store"
import { useAuth } from "@/lib/auth/clientAuth"
import { fetchOrganizations } from "@/lib/store/slices/billingSlice"
import type { BillFormValues } from "@/lib/types/billing"
import { eachDateInRange, toISODate, formatShortDate } from "@/lib/utils/date"

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

const WEEKDAYS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
]

const DEFAULT_VALUES: BillFormValues = {
  dateRange: { from: undefined, to: undefined },
  organizationId: "",
  billingType: "trip",
  weeklyHolidays: [5, 6], // Friday + Saturday
  extraHolidays: [],
  rates: { inStation: 150, outStation: 200, remote: 685 },
  penalties: { day1: 10, day2: 20, day3: 30, day4: 40 },
}

export default function BillGenerationClient() {
  const dispatch = useAppDispatch()
  const { token } = useAuth()
  const { items: orgs, isLoading: orgsLoading } = useAppSelector(
    (s) => s.billing.organizations
  )

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BillFormValues>({ defaultValues: DEFAULT_VALUES })

  useEffect(() => {
    if (token) dispatch(fetchOrganizations(token))
  }, [dispatch, token])

  const dateRange = watch("dateRange")
  const weeklyHolidays = watch("weeklyHolidays")
  const extraHolidays = watch("extraHolidays")

  // Dates in range that fall on weekly holidays
  const weeklyHolidayDates = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return []
    return eachDateInRange(dateRange)
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

  function onSubmit(data: BillFormValues) {
    // eslint-disable-next-line no-console
    console.log("Bill form submitted:", data)
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Bill Generation</h2>
        <p className="text-sm text-muted-foreground">
          Configure billing parameters and generate a CSV report per
          organization.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* ── Date Range ── */}
        <Card>
          <CardHeader>
            <CardTitle>Billing Period</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label>Date Range</Label>
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
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="org">Organization</Label>
              <Controller
                control={control}
                name="organizationId"
                rules={{ required: "Please select an organization" }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full" id="org">
                      <SelectValue
                        placeholder={
                          orgsLoading ? "Loading…" : "Select organization"
                        }
                      />
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
                          key={org.id ?? org.group_id}
                          value={String(org.id ?? org.group_id)}
                        >
                          {org.name ?? org.group_name}
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
              <Label htmlFor="billingType">Billing Type</Label>
              <Controller
                control={control}
                name="billingType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full" id="billingType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trip">Trip wise</SelectItem>
                      <SelectItem value="location">Location wise</SelectItem>
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

            {/* Unified holiday date chips — weekly (muted) + extra (amber) */}
            {(weeklyHolidayDates.length > 0 || extraHolidays.length > 0) && (
              <div className="grid gap-1.5">
                <p className="text-xs text-muted-foreground">
                  {weeklyHolidayDates.length + extraHolidays.length} holiday
                  date
                  {weeklyHolidayDates.length + extraHolidays.length !== 1
                    ? "s"
                    : ""}{" "}
                  in selected range:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {weeklyHolidayDates.map((iso) => (
                    <span
                      key={iso}
                      className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                    >
                      {formatShortDate(iso)}
                      <button
                        type="button"
                        onClick={() => removeWeeklyHolidayDate(iso)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${iso}`}
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  ))}
                  {extraHolidays.map((iso) => (
                    <span
                      key={iso}
                      className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    >
                      {formatShortDate(iso)}
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

            {/* Extra holidays calendar */}
            <div className="grid gap-2">
              <Label>Extra Holidays</Label>
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
                <Label htmlFor={`rate-${key}`}>{label}</Label>
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

        {/* ── SLA Penalties ── */}
        <Card>
          <CardHeader>
            <CardTitle>SLA Breach Penalties (%)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            {(
              [
                { key: "day1", label: "1 Day" },
                { key: "day2", label: "2 Days" },
                { key: "day3", label: "3 Days" },
                { key: "day4", label: "4 Days" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="grid gap-2">
                <Label htmlFor={`penalty-${key}`}>{label}</Label>
                <Input
                  id={`penalty-${key}`}
                  type="number"
                  min={0}
                  max={100}
                  {...register(`penalties.${key}`, {
                    required: "Required",
                    min: { value: 0, message: "Must be ≥ 0" },
                    max: { value: 100, message: "Must be ≤ 100" },
                    valueAsNumber: true,
                  })}
                  aria-invalid={!!errors.penalties?.[key]}
                />
                {errors.penalties?.[key] && (
                  <p className="text-xs text-destructive">
                    {errors.penalties[key]?.message}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            Generate Bill
          </Button>
        </div>
      </form>
    </div>
  )
}
