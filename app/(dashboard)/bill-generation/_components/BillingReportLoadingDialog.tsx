"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

// Estimate ≈ 15 s of processing per selected billing day; if the run isn't
// done by then the estimate is extended by 30 s so the countdown never sits
// at 00:00 mid-run.
const SECONDS_PER_DAY = 15
const EXTENSION_SECONDS = 30
// Bar never reaches 100% while running — only the done phase fills it.
const MAX_DISPLAYED_PROGRESS = 95

// Milestones as fractions of the estimate, so the labels track the run for
// both a 1-day (15 s) and a month-long (~8 min) report.
const STEPS = [
  { frac: 0, label: "Downloading trips…" },
  { frac: 0.25, label: "Classifying In / Out / Remote…" },
  { frac: 0.6, label: "Calculating bills…" },
  { frac: 0.9, label: "Finalizing report…" },
]

function useElapsed(open: boolean, frozen: boolean) {
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    if (!open) {
      setElapsed(0)
      return
    }
    if (frozen) return
    const start = Date.now()
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      250,
    )
    return () => clearInterval(id)
  }, [open, frozen])
  return elapsed
}

function useEstimate(
  open: boolean,
  elapsed: number,
  frozen: boolean,
  base: number,
) {
  const [estimate, setEstimate] = React.useState(base)
  // The estimate the run started with — overtime is measured against it,
  // not against the extended value.
  const [initialEstimate, setInitialEstimate] = React.useState(base)
  // Re-base on every open/close and whenever the day count changes.
  React.useEffect(() => {
    setEstimate(base)
    setInitialEstimate(base)
  }, [open, base])
  React.useEffect(() => {
    if (open && !frozen && elapsed >= estimate) {
      setEstimate((e) => e + EXTENSION_SECONDS)
    }
  }, [open, frozen, elapsed, estimate])
  return { estimate, initialEstimate }
}

const pad = (n: number) => n.toString().padStart(2, "0")

function DigitBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-1">
        {value.split("").map((d, i) => (
          <span
            key={i}
            className="flex h-11 w-9 items-center justify-center rounded-md border bg-muted/50 font-mono text-2xl font-semibold tabular-nums"
          >
            {d}
          </span>
        ))}
      </div>
      <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  )
}

export function BillingReportLoadingDialog({
  open,
  phase = "running",
  days = 1,
}: {
  open: boolean
  phase?: "running" | "done"
  /** Selected billing days — the time estimate is ~15 s per day. */
  days?: number
}) {
  const done = phase === "done"
  const elapsed = useElapsed(open, done)
  const base = Math.max(days, 1) * SECONDS_PER_DAY
  const { estimate, initialEstimate } = useEstimate(open, elapsed, done, base)

  const remaining = done ? 0 : Math.max(estimate - elapsed, 0)
  const overtime = elapsed > initialEstimate
  const progress = done
    ? 100
    : Math.min((elapsed / estimate) * 100, MAX_DISPLAYED_PROGRESS)
  const step =
    [...STEPS].reverse().find((s) => elapsed >= s.frac * estimate) ?? STEPS[0]

  // Ring geometry
  const r = 52
  const c = 2 * Math.PI * r

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm gap-0 overflow-hidden p-0">
        <div className="flex flex-col items-center gap-5 px-6 pt-7 pb-5">
          {/* Clock with progress ring */}
          <div className="relative flex size-36 items-center justify-center">
            <svg
              className="absolute inset-0 -rotate-90"
              viewBox="0 0 120 120"
              aria-hidden="true"
            >
              <circle
                cx="60"
                cy="60"
                r={r}
                className="fill-none stroke-muted"
                strokeWidth="6"
              />
              <circle
                cx="60"
                cy="60"
                r={r}
                className="fill-none stroke-primary transition-[stroke-dashoffset] duration-500 ease-linear"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c - (progress / 100) * c}
              />
            </svg>
            <div className="flex flex-col items-center">
              <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
                {pad(Math.floor(elapsed / 60))}
                <span className="animate-pulse text-muted-foreground">:</span>
                {pad(elapsed % 60)}
              </span>
              <span className="mt-0.5 text-[10px] tracking-widest text-muted-foreground uppercase">
                elapsed
              </span>
            </div>
          </div>

          {/* Countdown */}
          <div className="flex items-start gap-2">
            <DigitBlock value={pad(Math.floor(remaining / 60))} label="min" />
            <span className="pt-1.5 font-mono text-2xl font-semibold text-muted-foreground animate-pulse">
              :
            </span>
            <DigitBlock value={pad(remaining % 60)} label="sec" />
          </div>

          <div className="grid gap-1.5 text-center">
            <DialogTitle className="text-base">
              Generating billing report
            </DialogTitle>
            <DialogDescription className="text-xs">
              {done
                ? "Your report is ready."
                : overtime
                  ? "Taking a little longer than usual — almost there."
                  : "Estimated time remaining. Please keep this tab open."}
            </DialogDescription>
          </div>
        </div>

        {/* Footer status */}
        <div className="border-t bg-muted/50 px-6 py-4">
          <div className="mb-2 flex items-center gap-2 text-sm">
            {done ? (
              <CheckIcon className="size-4 text-primary" />
            ) : (
              <Spinner className="size-4 text-primary" />
            )}
            <span
              key={done ? "done" : step.label}
              className="animate-in fade-in slide-in-from-bottom-1 font-medium"
            >
              {done ? "Completed — report ready" : step.label}
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-1.5 gap-0" />
          <div className="mt-3 flex justify-between">
            {STEPS.map((s) => (
              <span
                key={s.label}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  elapsed >= s.frac * estimate || done
                    ? "bg-primary"
                    : "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
