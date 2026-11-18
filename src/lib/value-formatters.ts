import {FileFormat} from './file-format-spec'
import {zeroPad} from './utils'

export interface ValueFormatter {
  unit: FileFormat.ValueUnit
  format(v: number, step?: number): string
}

function precisionForStep(step: number | undefined, fallback: number): number {
  if (step === undefined || !Number.isFinite(step) || step <= 0) return fallback
  return Math.min(20, Math.max(fallback, -Math.floor(Math.log10(step))))
}

export class RawValueFormatter implements ValueFormatter {
  unit: FileFormat.ValueUnit = 'none'
  format(v: number, step?: number) {
    if (step === undefined) return v.toLocaleString()
    return v.toLocaleString(undefined, {maximumFractionDigits: precisionForStep(step, 3)})
  }
}

export class TimeFormatter implements ValueFormatter {
  private multiplier: number

  constructor(public unit: 'nanoseconds' | 'microseconds' | 'milliseconds' | 'seconds') {
    if (unit === 'nanoseconds') this.multiplier = 1e-9
    else if (unit === 'microseconds') this.multiplier = 1e-6
    else if (unit === 'milliseconds') this.multiplier = 1e-3
    else this.multiplier = 1
  }

  formatUnsigned(v: number, step?: number) {
    const s = v * this.multiplier
    const secondsStep = step === undefined ? undefined : step * this.multiplier

    if (s / 60 >= 1) {
      if (secondsStep !== undefined && Number.isFinite(secondsStep) && secondsStep > 0) {
        const digits = precisionForStep(secondsStep, 0)
        const rounded = Number(s.toFixed(digits))
        const minutes = Math.floor(rounded / 60)
        const seconds = (rounded - minutes * 60).toFixed(digits)
        return `${minutes}:${zeroPad(seconds, digits ? digits + 3 : 2)}`
      }
      const minutes = Math.floor(s / 60)
      const seconds = Math.floor(s - minutes * 60).toString()
      return `${minutes}:${zeroPad(seconds, 2)}`
    }
    if (s / 1 >= 1) return `${s.toFixed(precisionForStep(secondsStep, 2))}s`
    if (s / 1e-3 >= 1)
      return `${(s / 1e-3).toFixed(
        precisionForStep(secondsStep === undefined ? undefined : secondsStep / 1e-3, 2),
      )}ms`
    if (s / 1e-6 >= 1)
      return `${(s / 1e-6).toFixed(
        precisionForStep(secondsStep === undefined ? undefined : secondsStep / 1e-6, 2),
      )}µs`
    else
      return `${(s / 1e-9).toFixed(
        precisionForStep(secondsStep === undefined ? undefined : secondsStep / 1e-9, 2),
      )}ns`
  }

  format(v: number, step?: number) {
    return `${v < 0 ? '-' : ''}${this.formatUnsigned(Math.abs(v), step)}`
  }
}

export class ByteFormatter implements ValueFormatter {
  unit: FileFormat.ValueUnit = 'bytes'

  format(v: number, step?: number) {
    if (v < 1024) return `${v.toFixed(precisionForStep(step, 0))} B`
    v /= 1024
    if (step !== undefined) step /= 1024
    if (v < 1024) return `${v.toFixed(precisionForStep(step, 2))} KB`
    v /= 1024
    if (step !== undefined) step /= 1024
    if (v < 1024) return `${v.toFixed(precisionForStep(step, 2))} MB`
    v /= 1024
    if (step !== undefined) step /= 1024
    return `${v.toFixed(precisionForStep(step, 2))} GB`
  }
}
