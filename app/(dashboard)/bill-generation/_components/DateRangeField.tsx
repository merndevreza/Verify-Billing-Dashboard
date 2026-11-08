"use client"

import { Fragment } from "react"
import {
  addDays,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatFullDate, toISODate } from "@/lib/utils/date"
import { Separator } from "@/components/ui/separator"

const MAX_RANGE_DAYS = 31

interface DateRangeFieldProps {
  value: DateRange
  onChange: (range: DateRange) => void
}

/** Quick-select presets; weeks start Sunday to match the calendar grid. */
function buildPresets(): { label: string; range: DateRange }[] {
  const today = startOfDay(new Date())
  const yesterday = addDays(today, -1)
  const lastWeekDate = addDays(today, -7)
  const lastMonthDate = startOfMonth(addDays(today, -today.getDate()))

  return [
    { label: "Today", range: { from: today, to: today } },
    { label: "Yesterday", range: { from: yesterday, to: yesterday } },
    { label: "This week", range: { from: startOfWeek(today), to: today } },
    {
      label: "Last week",
      range: {
        from: startOfWeek(lastWeekDate),
        to: startOfDay(endOfWeek(lastWeekDate)),
      },
    },
    {
      label: "This month",
      range: { from: startOfMonth(today), to: today },
    },
    {
      label: "Last month",
      range: {
        from: startOfMonth(lastMonthDate),
        to: startOfDay(endOfMonth(lastMonthDate)),
      },
    },
  ]
}

/** Billing-period date-range picker (popover calendar). */
export default function DateRangeField({
  value,
  onChange,
}: DateRangeFieldProps) {
  const { from, to } = value
  const label =
    from && to
      ? `${formatFullDate(from)} – ${formatFullDate(to)}`
      : "Select date range"

  const presets = buildPresets()
  const activePreset = presets.find(
    (p) =>
      p.range.from &&
      p.range.to &&
      from &&
      to &&
      toISODate(p.range.from) === toISODate(from) &&
      toISODate(p.range.to) === toISODate(to)
  )

  // Cap at 31 days: while the range is in progress (start picked, end not),
  // gray out everything outside start ± 30. The `max` prop below is the hard
  // enforcement — clicks before the start would otherwise complete an
  // unbounded { from: earlier, to: start } range, and focused disabled days
  // stay activatable via keyboard.
  const selecting = !!from && !to
  const disabled = selecting
    ? [
      {
        before: addDays(from, -(MAX_RANGE_DAYS - 1)),
        after: addDays(from, MAX_RANGE_DAYS - 1),
      },
    ]
    : []

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" className="w-full justify-start font-normal" />}
      >
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        <span className={from && to ? "" : "text-muted-foreground"}>{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="flex w-28 shrink-0 flex-col gap-0.5 border-r p-1">
            <p className="px-2 py-1 text-[0.8rem] font-medium text-muted-foreground">
              Presets
            </p>
            {presets.map((preset, i) => (
              <Fragment key={preset.label}>
                {/* Group presets: days | weeks | months */}
                {(i === 2 || i === 4) && <Separator className="mx-2 my-1" />}
                <Button
                  variant={preset === activePreset ? "secondary" : "ghost"}
                  className="h-7 w-full justify-start px-2 text-xs font-normal"
                  onClick={() => onChange(preset.range)}
                >
                  {preset.label}
                </Button>
              </Fragment>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              selected={value}
              onSelect={(range) => onChange(range ?? { from: undefined, to: undefined })}
              numberOfMonths={1}
              max={MAX_RANGE_DAYS - 1}
              disabled={disabled}
            />
            {selecting && (
              <p className="mt-auto px-2 py-1 text-[10px] leading-snug text-destructive bg-accent">
                Select up to 1 month (31 days) at a time.
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
