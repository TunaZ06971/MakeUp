#if os(iOS)
  import ARKit
  import AVFoundation
  import CoreImage
  import MakeUpCore
  import Observation
  import SceneKit
  import SwiftUI

  @MainActor @Observable
  final class ARFaceCapture: NSObject, @preconcurrency ARSessionDelegate {
    var guide = ScanProtocol(side: "left")
    var side = "left"
    var measuredMode = true
    var depthSampleCount = 0
    private var depthSamples: [MeasuredDepthSample] = []
    private var depthViews: [DepthKeyframe] = []
    private var depthWaitSince: Double?
    private var buildTask: Task<Void, Never>?
    var status = ""
    var failure = false
    var running = false
    var completed: FaceScan?
    let view = ARSCNView(frame: .zero)
    private let context = CIContext()
    private var last = 0.0
    private var epoch = 0
    private var frames: [ScanFrame] = []
    private var expressions: [String: [Float]] = [:]
    private var uv: [Float] = []
    private var triangles: [Int] = []
    private var source = "arkit-rgb"
    static var supported: Bool { ARFaceTrackingConfiguration.isSupported }

    override init() {
      super.init()
      view.session.delegate = self
      view.session.delegateQueue = .main
      view.scene = SCNScene()
      view.automaticallyUpdatesLighting = false
    }
    func start() async {
      guard Self.supported else {
        fail("unsupported")
        return
      }
      epoch += 1
      let current = epoch
      let permission = await AVCaptureDevice.requestAccess(for: .video)
      guard current == epoch else { return }
      guard permission else {
        fail("denied")
        return
      }
      guide = ScanProtocol(side: side)
      depthSamples = []
      depthViews = []
      depthSampleCount = 0
      depthWaitSince = nil
      frames = []
      expressions = [:]
      triangles = []
      uv = []
      last = 0
      failure = false
      completed = nil
      status = "starting"
      let configuration = ARFaceTrackingConfiguration()
      configuration.maximumNumberOfTrackedFaces = min(
        2, ARFaceTrackingConfiguration.supportedNumberOfTrackedFaces)
      configuration.isLightEstimationEnabled = true
      // Explicitly prefer a TrueDepth format when this device exposes one.
      if let format = ARFaceTrackingConfiguration.supportedVideoFormats.first(where: {
        $0.captureDeviceType == .builtInTrueDepthCamera
      }) {
        configuration.videoFormat = format
        source = measuredMode ? "truedepth-measured" : "arkit-truedepth"
      } else {
        if measuredMode { fail("noDepth"); return }
        source = "arkit-rgb"
      }
      running = true
      view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }
    func stop() {
      epoch += 1
      buildTask?.cancel()
      buildTask = nil
      running = false
      view.session.pause()
    }
    func interrupt() { if running { fail("interrupted") } }
    private func fail(_ message: String) {
      stop()
      status = message
      failure = true
    }
    func session(_ session: ARSession, didFailWithError error: Error) { fail("cameraError") }
    func sessionWasInterrupted(_ session: ARSession) { fail("interrupted") }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
      guard running, frame.timestamp - last > 0.1 else { return }
      last = frame.timestamp
      let anchors = frame.anchors.compactMap { $0 as? ARFaceAnchor }.filter(\.isTracked)
      guard let face = anchors.first else {
        status = "noFace"
        _ = guide.update(
          .init(
            time: frame.timestamp * 1000, yaw: 0, pitch: 0, roll: 0, blink: 0, mouth: 0,
            faceSize: 0, brightness: 0, sharpness: 0, faceCount: 0, centered: false, tracking: false
          ))
        return
      }
      let depth = measuredMode ? ARDepthReader.read(frame, face: face) : nil
      if measuredMode && depth == nil {
        if depthWaitSince == nil { depthWaitSince = frame.timestamp }
        if frame.timestamp - depthWaitSince! > 10 { fail("noDepth") } else { status = "waitingDepth" }
        return
      }
      depthWaitSince = nil
      let points = face.geometry.vertices
      let relative = simd_inverse(frame.camera.transform) * face.transform
      let normal = ScanProjection.portraitDirection(
        SIMD3(relative.columns.2.x, relative.columns.2.y, relative.columns.2.z))
      let horizontal = ScanProjection.portraitDirection(
        SIMD3(relative.columns.0.x, relative.columns.0.y, relative.columns.0.z))
      let yaw = atan2(Double(normal.x), Double(normal.z))
      let pitch = atan2(Double(normal.y), hypot(Double(normal.x), Double(normal.z)))
      let roll = atan2(Double(horizontal.y), Double(horizontal.x))
      let raw = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
      let scale = min(1, 1920 / raw.extent.height)
      let image = raw.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      guard let photo = context.createCGImage(image, from: image.extent) else { return }
      let resolution = SIMD2(
        Float(frame.camera.imageResolution.width), Float(frame.camera.imageResolution.height))
      let projection = points.flatMap { point -> [Float] in
        let camera = relative * SIMD4(point, 1)
        let p = ScanProjection.portraitPoint(
          SIMD3(camera.x, camera.y, camera.z), intrinsics: frame.camera.intrinsics,
          resolution: resolution)
        return [p.x, p.y]
      }

      let xs = stride(from: 0, to: projection.count, by: 2).map { projection[$0] }
      let ys = stride(from: 1, to: projection.count, by: 2).map { projection[$0] }
      let x0 = xs.min()!
      let x1 = xs.max()!
      let y0 = ys.min()!
      let y1 = ys.max()!
      let quality = Self.quality(
        photo,
        rect: CGRect(x: Double(x0), y: Double(y0), width: Double(x1 - x0), height: Double(y1 - y0)))
      let observation = ScanObservation(
        time: frame.timestamp * 1000, yaw: yaw, pitch: pitch, roll: roll,
        blink: min(
          face.blendShapes[.eyeBlinkLeft]?.doubleValue ?? 0,
          face.blendShapes[.eyeBlinkRight]?.doubleValue ?? 0),
        mouth: face.blendShapes[.jawOpen]?.doubleValue ?? 0, faceSize: Double(y1 - y0),
        brightness: quality.0, sharpness: quality.1,
        faceCount: anchors.count,
        centered: abs((x0 + x1) / 2 - 0.5) < 0.2
          && y0 > (measuredMode ? 0.12 : 0.025) && y1 < 0.96
          && (!measuredMode || (x0 > 0.08 && x1 < 0.92)),
        tracking: face.isTracked)
      let action = guide.update(observation)
      status = action.issue ?? ""
      let vertices = points.flatMap { [$0.x, $0.y, $0.z] }
      if let depth, observation.mouth < 0.18, observation.blink < 0.28,
         guide.progress > 0 || action.accepted != nil,
         guide.step != "blink", guide.step != "mouth", depthSamples.count < 64 {
        depthSamples.append(depth)
        depthSampleCount = depthSamples.count
      }
      if let expression = action.expression { expressions[expression] = vertices }
      if let step = action.accepted, step != "blink", step != "mouth" {
        if triangles.isEmpty {
          triangles = Self.closeInteriorHoles(face.geometry.triangleIndices.map(Int.init))
          uv = face.geometry.textureCoordinates.flatMap { [$0.x, 1 - $0.y] }
        }
        var weights: [Float] = []
        for t in stride(from: 0, to: triangles.count, by: 3) {
          let a = points[triangles[t]]
          let b = points[triangles[t + 1]]
          let c = points[triangles[t + 2]]
          let n = simd_normalize(simd_cross(b - a, c - a))
          let cameraNormal = relative * SIMD4(n, 0)
          weights.append(cameraNormal.z.isFinite ? pow(max(0, cameraNormal.z), 4) : 0)
        }
        guard let encoded = ScanImage.encode(photo) else {
          fail("buildError")
          return
        }
        let detection = try? FaceLandmarkService().detect(in: photo)
        let landmarks = detection?.meshPoints?.map { ScanPoint(x: Float($0.x), y: Float($0.y)) }
        frames.append(
          ScanFrame(
            step: step, image: encoded, projection: projection, weights: weights,
            vertices: vertices, landmarks: landmarks))
        if let depth, let photo = frames.last { depthViews.append(DepthKeyframe(sample: depth, photo: photo)) }
      }
      if guide.complete {
        stop()
        status = "building"
        let capturedFrames = frames, capturedSamples = depthSamples, capturedViews = depthViews
        let capturedUV = uv, capturedTriangles = triangles, capturedExpressions = expressions
        let capturedSource = source, steps = guide.sequence.filter { !guide.skippedSteps.contains($0) }, useDepth = measuredMode, current = epoch
        buildTask = Task {
          let job = Task.detached(priority: .userInitiated) {
            var scan: FaceScan
            if useDepth {
              scan = try DepthSurface.build(samples: capturedSamples, views: capturedViews,
                faceVertices: capturedFrames.first?.vertices ?? [], completedSteps: steps)
              scan.depthArchive = DepthArchive(samples: capturedSamples, views: capturedViews)
            } else {
              scan = FaceScan(source: capturedSource, units: "meters", vertices: FaceScan.fuse(capturedFrames), uv: capturedUV,
                triangles: capturedTriangles, frames: capturedFrames, expressions: capturedExpressions, texture: "", completedSteps: steps)
            }
            guard let texture = ScanImage.encode(try ScanAtlas.bake(scan), png: true) else { throw ScanError.image }
            scan.texture = texture
            try scan.validate()
            return scan
          }
          do {
            let scan = try await withTaskCancellationHandler { try await job.value } onCancel: { job.cancel() }
            guard !Task.isCancelled, current == epoch else { return }
            completed = scan
          } catch is CancellationError {} catch {
            if current == epoch { fail(useDepth ? "insufficientDepth" : "buildError") }
          }
        }
      }
    }
    /// Small interior loops receive appearance caps, not anatomical eyeballs or teeth.
    private static func closeInteriorHoles(_ indices: [Int]) -> [Int] {
      struct Edge: Hashable {
        var a: Int
        var b: Int
        init(_ a: Int, _ b: Int) {
          self.a = min(a, b)
          self.b = max(a, b)
        }
      }
      var counts: [Edge: Int] = [:]
      var directions: [Edge: (Int, Int)] = [:]
      for t in stride(from: 0, to: indices.count, by: 3) {
        for k in 0..<3 {
          let a = indices[t + k]
          let b = indices[t + (k + 1) % 3]
          let key = Edge(a, b)
          counts[key, default: 0] += 1
          directions[key] = (a, b)
        }
      }
      var next: [Int: Int] = [:]
      for (edge, count) in counts where count == 1 {
        if let (a, b) = directions[edge] { next[a] = b }
      }
      var loops: [[Int]] = []
      while let start = next.keys.first {
        var loop = [start]
        var cursor = start
        while let n = next.removeValue(forKey: cursor), n != start {
          loop.append(n)
          cursor = n
          if loop.count > indices.count { break }
        }
        if loop.count >= 3 { loops.append(loop) }
      }
      let outer = loops.map(\.count).max() ?? 0
      var result = indices
      for loop in loops where loop.count < outer && loop.count <= 120 {
        for i in 1..<loop.count - 1 { result += [loop[0], loop[i + 1], loop[i]] }
      }
      return result
    }
    private static func quality(_ image: CGImage, rect: CGRect) -> (Double, Double) {
      let pixels = CGRect(
        x: rect.minX * CGFloat(image.width), y: rect.minY * CGFloat(image.height),
        width: rect.width * CGFloat(image.width), height: rect.height * CGFloat(image.height)
      ).intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
      guard !pixels.isEmpty, let crop = image.cropping(to: pixels),
        let ctx = CGContext(
          data: nil, width: 96, height: 96, bitsPerComponent: 8, bytesPerRow: 96,
          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { return (0, 0) }
      ctx.draw(crop, in: CGRect(x: 0, y: 0, width: 96, height: 96))
      let data = ctx.data!.assumingMemoryBound(to: UInt8.self)
      var sum = 0.0
      var sharp = 0.0
      for i in 0..<96 * 96 { sum += Double(data[i]) }
      for y in 1..<95 {
        for x in 1..<95 {
          let i = y * 96 + x
          let lap =
            4 * Double(data[i]) - Double(data[i - 1]) - Double(data[i + 1]) - Double(data[i - 96])
            - Double(data[i + 96])
          sharp += lap * lap
        }
      }
      return (sum / (96 * 96 * 255), sharp / (94 * 94))
    }
  }
  private struct ARCaptureSurface: UIViewRepresentable {
    let capture: ARFaceCapture
    func makeUIView(context: Context) -> ARSCNView { capture.view }
    func updateUIView(_ view: ARSCNView, context: Context) {}
  }
  struct ARGuidedCaptureView: View {
    let onComplete: (FaceScan) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var capture = ARFaceCapture()
    var body: some View {
      NavigationStack {
        ScrollView {
          VStack(spacing: 16) {
            Text("scan.prepare").font(.subheadline)
            if !capture.running && capture.completed == nil && capture.status != "building" {
              Toggle("scan.measuredMode", isOn: $capture.measuredMode)
              Text(capture.measuredMode ? "scan.measuredNotice" : "scan.coarseNotice").font(.caption).foregroundStyle(.secondary)
              Picker("scan.captureSide", selection: $capture.side) {
                Text("scan.captureLeft").tag("left")
                Text("scan.captureRight").tag("right")
                Text("scan.captureBoth").tag("both")
              }
            }
            Text("scan.privacy").font(.footnote).foregroundStyle(.secondary)
            if ARFaceCapture.supported {
              ARCaptureSurface(capture: capture).frame(height: 360).clipShape(
                RoundedRectangle(cornerRadius: 16))
              Text(LocalizedStringKey("scan.steps.\(capture.guide.step)")).font(.title3.bold())
              Text("\(min(capture.guide.index+1,8)) / 8").font(.caption)
              ProgressView(value: capture.guide.progress)
              if capture.running && ["leftProfile", "rightProfile"].contains(capture.guide.step) {
                Button("scan.skipProfile") { capture.guide.skipProfile() }.font(.caption)
              }
              Text(
                LocalizedStringKey(
                  "scan.feedback.\(capture.status.isEmpty ? "hold" : capture.status)")
              ).font(.footnote)
              if !capture.running && capture.completed == nil && capture.status != "building" {
                Button(capture.failure ? "scan.retry" : "scan.startCamera") {
                  Task { await capture.start() }
                }.buttonStyle(.borderedProminent)
              }
            } else {
              Text("scan.feedback.unsupported").foregroundStyle(.secondary).padding()
            }
          }.padding()
        }.navigationTitle("scan.title").toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("scan.close") {
              capture.stop()
              dismiss()
            }
          }
        }
      }
      .onChange(of: capture.completed?.id) { _, _ in
        if let scan = capture.completed {
          onComplete(scan)
          dismiss()
        }
      }
      .onChange(of: phase) { _, value in if value != .active { capture.interrupt() } }
      .onDisappear { capture.stop() }
    }
  }
#endif
