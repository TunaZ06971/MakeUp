/** Guided acquisition only: expression challenges are not identity/liveness verification. */
export const SCAN_STEPS = [
  'front',
  'left',
  'right',
  'up',
  'down',
  'blink',
  'mouth',
  'finish',
] as const
export type ScanStep = (typeof SCAN_STEPS)[number] | 'leftProfile' | 'rightProfile'
export type CaptureSide = 'left' | 'right' | 'both'
export const captureSteps = (side: CaptureSide): readonly ScanStep[] => side === 'both' ? SCAN_STEPS : ['front', side, side === 'left' ? 'leftProfile' : 'rightProfile', 'up', 'down', 'blink', 'mouth', 'finish']
export interface Observation {
  time: number
  faceCount: number
  yaw: number
  pitch: number
  roll: number
  blink: number
  mouth: number
  faceSize: number
  centered: boolean
  brightness: number
  sharpness: number
  tracking: boolean
}
export class ScanProtocol {
  readonly steps: readonly ScanStep[]
  constructor(side: CaptureSide = 'both') { this.steps = captureSteps(side) }
  index = 0
  progress = 0
  private since: number | null = null
  private lastTime: number | null = null
  private challenge = false
  readonly skippedSteps: string[] = []
  skipProfile() {
    if (!['leftProfile', 'rightProfile'].includes(this.step)) return false
    this.skippedSteps.push(this.step)
    this.index++
    this.resetHold()
    this.lastTime = null
    return true
  }
  get step() {
    return this.steps[Math.min(this.index, this.steps.length - 1)]
  }
  get complete() {
    return this.index === this.steps.length
  }
  resetHold() {
    this.since = null
    this.progress = 0
  }
  update(o: Observation): {
    accepted?: ScanStep
    captureExpression?: 'blink' | 'mouth'
    issue?: string
  } {
    if (this.complete) return {}
    if (
      this.lastTime !== null &&
      (o.time <= this.lastTime || o.time - this.lastTime > 500)
    ) {
      this.resetHold()
      this.challenge = false
    }
    this.lastTime = o.time
    const issue = ![
      o.time,
      o.yaw,
      o.pitch,
      o.roll,
      o.blink,
      o.mouth,
      o.faceSize,
      o.brightness,
      o.sharpness,
    ].every(Number.isFinite)
      ? 'noFace'
      : !o.tracking || o.faceCount === 0
        ? 'noFace'
        : o.faceCount !== 1
          ? 'oneFace'
          : !o.centered
            ? 'center'
            : o.faceSize < 0.25
              ? 'closer'
              : o.faceSize > 0.88
                ? 'farther'
                : o.brightness < 0.16
                  ? 'dark'
                  : o.brightness > 0.9
                    ? 'bright'
                    : o.sharpness < 8
                      ? 'blur'
                      : Math.abs(o.roll) > 0.2
                        ? 'level'
                        : undefined
    if (issue) {
      this.resetHold()
      this.challenge = false
      return { issue }
    }
    const front = Math.abs(o.yaw) < 0.16 && Math.abs(o.pitch) < 0.18
    const neutral = o.mouth < 0.18 && o.blink < 0.28
    const step = this.step
    if (step === 'blink' || step === 'mouth') {
      if (!front) {
        this.resetHold()
        this.challenge = false
        return { issue: 'front' }
      }
      const active =
        step === 'blink'
          ? o.blink > 0.6 && o.mouth < 0.18
          : o.mouth > 0.5 && o.blink < 0.3
      if (!this.challenge) {
        if (!active) {
          this.resetHold()
          return { issue: 'performAction' }
        }
        this.since ??= o.time
        if (o.time - this.since < 80) return {}
        this.challenge = true
        this.resetHold()
        this.progress = 0.5
        return { captureExpression: step }
      }
      if (!neutral) {
        this.since = null
        this.progress = 0.5
        return { issue: 'relax' }
      }
    } else {
      const pose =
        step === 'front' || step === 'finish'
          ? front
          : step === 'left'
            ? o.yaw > 0.38 && o.yaw < 0.75 && Math.abs(o.pitch) < 0.22
            : step === 'right'
              ? o.yaw < -0.38 && o.yaw > -0.75 && Math.abs(o.pitch) < 0.22
              : step === 'leftProfile' ? o.yaw > 0.88 && o.yaw < 1.5 && Math.abs(o.pitch) < 0.25
              : step === 'rightProfile' ? o.yaw < -0.88 && o.yaw > -1.5 && Math.abs(o.pitch) < 0.25
              : step === 'up'
                ? o.pitch > 0.18 && o.pitch < 0.42 && Math.abs(o.yaw) < 0.18
                : o.pitch < -0.16 && o.pitch > -0.4 && Math.abs(o.yaw) < 0.18
      if (!pose || !neutral) {
        this.resetHold()
        return { issue: !neutral ? 'relax' : 'adjustPose' }
      }
    }
    this.since ??= o.time
    const duration = step === 'blink' || step === 'mouth' ? 350 : 650
    this.progress = Math.min(1, (o.time - this.since) / duration)
    if (this.progress < 1) return {}
    this.index++
    this.challenge = false
    this.resetHold()
    return { accepted: step }
  }
}
