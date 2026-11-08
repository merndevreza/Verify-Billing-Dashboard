"use client"

import * as React from "react"

import { Dialog, DialogContent } from "@/components/ui/dialog"

// Estimate ≈ 12 s of processing per selected billing day; if the run isn't
// done by then the estimate is extended by 30 s so the countdown never sits
// at 00:00 mid-run.
const SECONDS_PER_DAY = 12
const EXTENSION_SECONDS = 30
// Bar never reaches 100% while running — only the done phase fills it.
const MAX_DISPLAYED_PROGRESS = 95

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
      () => setElapsed((Date.now() - start) / 1000),
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
  // Re-base on every open/close and whenever the day count changes.
  React.useEffect(() => {
    setEstimate(base)
  }, [open, base])
  React.useEffect(() => {
    if (open && !frozen && elapsed >= estimate) {
      setEstimate((e) => e + EXTENSION_SECONDS)
    }
  }, [open, frozen, elapsed, estimate])
  return estimate
}

// Counts up at 60 fps toward the real progress instead of stepping once per
// tick. Monotonic: when the estimate extends and the real target dropped below
// the shown value, the count pauses until reality catches up — never jumping
// backward. When done, it fills to 100% over the ring's 500 ms transition.
function useAnimatedProgress(
  open: boolean,
  progress: number,
  done: boolean,
  estimate: number,
) {
  const [value, setValue] = React.useState(0)
  const valueRef = React.useRef(0)

  React.useEffect(() => {
    if (!open) {
      valueRef.current = 0
      setValue(0)
      return
    }
    const goal = done ? 100 : Math.min(progress, MAX_DISPLAYED_PROGRESS)
    if (goal <= valueRef.current) return

    const from = valueRef.current
    const start = performance.now()
    // Move at the real progress rate (100% per `estimate` s) so each tween
    // lands roughly when the next progress tick arrives.
    const duration = done ? 500 : (goal - from) * estimate * 10
    let id: number
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      valueRef.current = from + (goal - from) * t
      setValue(valueRef.current)
      if (t < 1) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [open, progress, done, estimate])

  return value
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
  /** Selected billing days — the time estimate is ~12 s per day. */
  days?: number
}) {
  const done = phase === "done"
  const elapsed = useElapsed(open, done)
  const base = Math.max(days, 1) * SECONDS_PER_DAY
  const estimate = useEstimate(open, elapsed, done, base)

  const remaining = done ? 0 : Math.max(Math.ceil(estimate - elapsed), 0)
  const progress = done
    ? 100
    : Math.min((elapsed / estimate) * 100, MAX_DISPLAYED_PROGRESS)
  const displayProgress = useAnimatedProgress(open, progress, done, estimate)

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
              <span className="font-mono text-3xl font-semibold text-muted-foreground">
                {Math.round(displayProgress)}%
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
