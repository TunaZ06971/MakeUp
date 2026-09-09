import Foundation

public struct ScanObservation: Sendable {
  public var time: Double, yaw: Double, pitch: Double, roll: Double, blink: Double, mouth: Double,
    faceSize: Double, brightness: Double, sharpness: Double
  public var faceCount: Int
  public var centered: Bool, tracking: Bool
  public init(
    time: Double, yaw: Double, pitch: Double, roll: Double, blink: Double, mouth: Double,
    faceSize: Double, brightness: Double, sharpness: Double, faceCount: Int, centered: Bool,
    tracking: Bool
  ) {
    self.time = time
    self.yaw = yaw
    self.pitch = pitch
    self.roll = roll
    self.blink = blink
    self.mouth = mouth
    self.faceSize = faceSize
    self.brightness = brightness
    self.sharpness = sharpness
    self.faceCount = faceCount
    self.centered = centered
    self.tracking = tracking
  }
}
public struct ScanProtocol: Sendable {
  public static let steps = ["front", "left", "right", "up", "down", "blink", "mouth", "finish"]
  public let sequence: [String]
  public private(set) var index = 0
  public private(set) var progress = 0.0
  private var since: Double?
  private var lastTime: Double?
  private var challenge = false
  public private(set) var skippedSteps: [String] = []
  @discardableResult public mutating func skipProfile() -> Bool {
    guard step == "leftProfile" || step == "rightProfile" else { return false }
    skippedSteps.append(step)
    index += 1
    resetHold()
    lastTime = nil
    return true
  }
  public var step: String { sequence[min(index, sequence.count - 1)] }
  public var complete: Bool { index == sequence.count }
  public init(side: String = "both") {
    sequence = side == "both" ? Self.steps : ["front", side == "right" ? "right" : "left",
      side == "right" ? "rightProfile" : "leftProfile", "up", "down", "blink", "mouth", "finish"]
  }
  public struct Action: Sendable {
    public var accepted: String?
    public var expression: String?
    public var issue: String?
  }
  private mutating func resetHold() {
    since = nil
    progress = 0
  }
  public mutating func update(_ o: ScanObservation) -> Action {
    if complete { return Action() }
    if let lastTime, o.time <= lastTime || o.time - lastTime > 500 {
      resetHold()
      challenge = false
    }
    lastTime = o.time
    let valid = [
      o.time, o.yaw, o.pitch, o.roll, o.blink, o.mouth, o.faceSize, o.brightness, o.sharpness,
    ].allSatisfy(\.isFinite)
    let issue: String? =
      !valid || !o.tracking || o.faceCount == 0
      ? "noFace"
      : o.faceCount != 1
        ? "oneFace"
        : !o.centered
          ? "center"
          : o.faceSize < 0.25
            ? "closer"
            : o.faceSize > 0.88
              ? "farther"
              : o.brightness < 0.16
                ? "dark"
                : o.brightness > 0.9
                  ? "bright" : o.sharpness < 8 ? "blur" : abs(o.roll) > 0.2 ? "level" : nil
    if let issue {
      resetHold()
      challenge = false
      return Action(issue: issue)
    }
    let front = abs(o.yaw) < 0.16 && abs(o.pitch) < 0.18
    let neutral = o.mouth < 0.18 && o.blink < 0.28
    let step = step
    if step == "blink" || step == "mouth" {
      if !front {
        resetHold()
        challenge = false
        return Action(issue: "front")
      }
      let active =
        step == "blink" ? o.blink > 0.6 && o.mouth < 0.18 : o.mouth > 0.5 && o.blink < 0.3
      if !challenge {
        if !active {
          resetHold()
          return Action()
        }
        if since == nil { since = o.time }
        if o.time - since! < 80 { return Action() }
        challenge = true
        resetHold()
        progress = 0.5
        return Action(expression: step)
      }
      if !neutral {
        since = nil
        progress = 0.5
        return Action(issue: "relax")
      }
    } else {
      let pose: Bool
      switch step {
      case "front", "finish": pose = front
      case "left": pose = o.yaw > 0.38 && o.yaw < 0.75 && abs(o.pitch) < 0.22
      case "right": pose = o.yaw < -0.38 && o.yaw > -0.75 && abs(o.pitch) < 0.22
      case "leftProfile": pose = o.yaw > 0.88 && o.yaw < 1.5 && abs(o.pitch) < 0.25
      case "rightProfile": pose = o.yaw < -0.88 && o.yaw > -1.5 && abs(o.pitch) < 0.25
      case "up": pose = o.pitch > 0.18 && o.pitch < 0.42 && abs(o.yaw) < 0.18
      default: pose = o.pitch < -0.16 && o.pitch > -0.4 && abs(o.yaw) < 0.18
      }
      if !pose || !neutral {
        resetHold()
        return Action(issue: neutral ? nil : "relax")
      }
    }
    if since == nil { since = o.time }
    let duration = step == "blink" || step == "mouth" ? 350.0 : 650.0
    progress = min(1, (o.time - since!) / duration)
    if progress < 1 { return Action() }
    index += 1
    challenge = false
    resetHold()
    return Action(accepted: step)
  }
}
