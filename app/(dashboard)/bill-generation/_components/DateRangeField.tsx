"use client"

import { CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatFullDate } from "@/lib/utils/date"

interface DateRangeFieldProps {
  value: DateRange
  onChange: (range: DateRange) => void
}

/** Billing-period date-range picker (popover calendar). */
export default function DateRangeField({ value, onChange }: DateRangeFieldProps) {
  const { from, to } = value
  const label =
    from && to
      ? `${formatFullDate(from)} – ${formatFullDate(to)}`
      : "Select date range"

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" className="w-full justify-start font-normal" />}
      >
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        <span className={from && to ? "" : "text-muted-foreground"}>{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={(range) => onChange(range ?? { from: undefined, to: undefined })}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  )
}
