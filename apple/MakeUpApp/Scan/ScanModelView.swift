import CoreGraphics
import MakeUpCore
import SceneKit
import SwiftUI

@MainActor
final class ScanScene: ObservableObject {
  let scene = SCNScene()
  let camera = SCNNode()
  let face = SCNNode()
  private var scan: FaceScan?
  private var vertices: [Float] = []
  private var distance: Float = 1
  private var lookups: [UVLookup?] = []
  var brush: TryOnView.BrushTarget?
  var onStroke: ([StrokePoint]) -> Void = { _ in }
  var onDirty: () -> Void = {}
  var moving = true
  private var points: [StrokePoint]?
  private var previous: StrokePoint?
  var painting: Bool { brush != nil && !moving }
  init() {
    camera.camera = SCNCamera()
    camera.camera?.zNear = 0.001
    camera.camera?.zFar = 100
    camera.camera?.fieldOfView = 35
    scene.rootNode.addChildNode(camera)
    scene.rootNode.addChildNode(face)
    for (position, intensity) in [(SCNVector3(-3, 4, 5), 2000.0), (SCNVector3(4, 1, 3), 600.0)] {
      let light = SCNNode(); light.light = SCNLight(); light.light?.type = .directional
      light.light?.intensity = CGFloat(intensity); light.position = position; light.look(at: SCNVector3Zero)
      scene.rootNode.addChildNode(light)
    }
    scene.background.contents = CGColor(gray: 0.085, alpha: 1)
  }
  func load(_ value: FaceScan) {
    coating(nil)
    scan = value
    vertices = value.vertices
    lookups = value.frames.map {
      $0.landmarks.map { UVLookup(landmarks: $0.map { CGPoint(x: Double($0.x), y: Double($0.y)) }) }
    }
    geometry(blink: 0, mouth: 0, wire: false)
    let p = stride(from: 0, to: vertices.count, by: 3).map {
      SIMD3(vertices[$0], vertices[$0 + 1], vertices[$0 + 2])
    }
    let minP = p.reduce(SIMD3<Float>(repeating: .infinity)) { simd_min($0, $1) }
    let maxP = p.reduce(SIMD3<Float>(repeating: -.infinity)) { simd_max($0, $1) }
    let center = (minP + maxP) / 2
    face.simdPosition = -center
    distance = max(maxP.y - minP.y, maxP.x - minP.x) * 1.85
    orient(0)
    face.geometry?.firstMaterial?.emission.contents = ScanImage.decode(value.texture)
  }
  func geometry(blink: Double, mouth: Double, wire: Bool) {
    guard let scan else { return }
    vertices = scan.vertices.indices.map { i in
      scan.vertices[i] + Float(blink)
        * ((scan.expressions["blink"]?[i] ?? scan.vertices[i]) - scan.vertices[i]) + Float(mouth)
        * ((scan.expressions["mouth"]?[i] ?? scan.vertices[i]) - scan.vertices[i])
    }
    let vertexSource = SCNGeometrySource(
      vertices: stride(from: 0, to: vertices.count, by: 3).map {
        SCNVector3(vertices[$0], vertices[$0 + 1], vertices[$0 + 2])
      })
    // CGImage-backed SceneKit materials sample V downward; the interchange format uses V up.
    let uv = SCNGeometrySource(
      textureCoordinates: stride(from: 0, to: scan.uv.count, by: 2).map {
        CGPoint(x: Double(scan.uv[$0]), y: Double(1 - scan.uv[$0 + 1]))
      })
    let element = SCNGeometryElement(
      indices: scan.triangles.map(Int32.init), primitiveType: .triangles)
    let material = face.geometry?.firstMaterial ?? SCNMaterial()
    material.lightingModel = .physicallyBased
    material.diffuse.contents = CGColor(gray: 0, alpha: 1)
    material.roughness.contents = 1.0
    material.clearCoat.textureComponents = .red
    material.clearCoatRoughness.textureComponents = .green
    material.isDoubleSided = false
    material.fillMode = wire ? .lines : .fill
    var normals = [SIMD3<Float>](repeating: .zero, count: vertices.count / 3)
    func point(_ i: Int) -> SIMD3<Float> { SIMD3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]) }
    for t in stride(from: 0, to: scan.triangles.count, by: 3) {
      let a = scan.triangles[t], b = scan.triangles[t + 1], c = scan.triangles[t + 2]
      let n = simd_cross(point(b) - point(a), point(c) - point(a))
      normals[a] += n; normals[b] += n; normals[c] += n
    }
    let normalSource = SCNGeometrySource(normals: normals.map { n in
      let v = simd_length(n) > 1e-8 ? simd_normalize(n) : SIMD3(0, 0, 1)
      return SCNVector3(v.x, v.y, v.z)
    })
    let geometry = SCNGeometry(sources: [vertexSource, normalSource, uv], elements: [element])
    geometry.materials = [material]
    face.geometry = geometry
  }
  func orient(_ angle: Float) {
    camera.position = SCNVector3(sin(angle) * distance, 0, cos(angle) * distance)
    camera.look(at: SCNVector3Zero)
  }
  func texture(_ image: CGImage) { face.geometry?.firstMaterial?.emission.contents = image }
  func coating(_ image: CGImage?) {
    if let image {
      face.geometry?.firstMaterial?.clearCoat.contents = image
      face.geometry?.firstMaterial?.clearCoatRoughness.contents = image
    } else {
      face.geometry?.firstMaterial?.clearCoat.contents = 0.0
      face.geometry?.firstMaterial?.clearCoatRoughness.contents = 1.0
    }
  }
  func begin(_ point: CGPoint, in view: SCNView) {
    guard let brush else { return }
    points = []
    previous = nil
    brush.layer.beginStroke(flow: brush.flow)
    paint(point, in: view)
  }
  func paint(_ point: CGPoint, in view: SCNView) {
    guard let brush, points != nil, let scan,
      let hit = view.hitTest(point, options: [.firstFoundOnly: true, .backFaceCulling: true]).first,
      hit.node === face
    else {
      previous = nil
      return
    }
    let t = hit.faceIndex * 3
    guard t + 2 < scan.triangles.count else {
      previous = nil
      return
    }
    let ids = Array(scan.triangles[t..<t + 3])
    func vertex(_ i: Int) -> SIMD3<Float> {
      SIMD3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2])
    }
    let a = vertex(ids[0])
    let v0 = vertex(ids[1]) - a
    let v1 = vertex(ids[2]) - a
    let v2 =
      SIMD3(
        Float(hit.localCoordinates.x), Float(hit.localCoordinates.y), Float(hit.localCoordinates.z))
      - a
    let d00 = simd_dot(v0, v0)
    let d01 = simd_dot(v0, v1)
    let d11 = simd_dot(v1, v1)
    let d20 = simd_dot(v2, v0)
    let d21 = simd_dot(v2, v1)
    let denom = d00 * d11 - d01 * d01
    guard abs(denom) > 1e-12 else {
      previous = nil
      return
    }
    let v = (d11 * d20 - d01 * d21) / denom
    let w = (d00 * d21 - d01 * d20) / denom
    let u = 1 - v - w
    for i in scan.frames.indices.sorted(by: {
      scan.frames[$0].weights[t / 3] > scan.frames[$1].weights[t / 3]
    }) {
      let p = scan.frames[i].projection
      let photo = CGPoint(
        x: Double(u * p[ids[0] * 2] + v * p[ids[1] * 2] + w * p[ids[2] * 2]),
        y: Double(u * p[ids[0] * 2 + 1] + v * p[ids[1] * 2 + 1] + w * p[ids[2] * 2 + 1]))
      if let uv = lookups[i]?.uv(atPhotoPoint: photo) {
        let next = StrokePoint(u: uv.x, v: uv.y, startsSegment: previous == nil)
        brush.layer.extendStroke(from: previous, to: next, radius: brush.radius)
        previous = next
        points?.append(next)
        onDirty()
        return
      }
    }
    previous = nil
  }
  func end() {
    guard let points else { return }
    brush?.layer.endStroke()
    self.points = nil
    previous = nil
    if !points.isEmpty { onStroke(points) }
    onDirty()
  }
  func cancel() {
    brush?.layer.cancelStroke()
    points = nil
    previous = nil
  }
}

#if os(iOS)
  private final class PaintSceneView: SCNView {
    var model: ScanScene?
    var paintGesture: UIPanGestureRecognizer?
    var tapGesture: UITapGestureRecognizer?
    func configure() {
      let pan = UIPanGestureRecognizer(target: self, action: #selector(paint(_:)))
      pan.maximumNumberOfTouches = 1
      paintGesture = pan
      addGestureRecognizer(pan)
      let tap = UITapGestureRecognizer(target: self, action: #selector(tap(_:)))
      tapGesture = tap
      addGestureRecognizer(tap)
    }
    @objc private func tap(_ gesture: UITapGestureRecognizer) {
      guard let model, model.painting else { return }
      model.begin(gesture.location(in: self), in: self)
      model.end()
    }
    @objc private func paint(_ gesture: UIPanGestureRecognizer) {
      guard let model, model.painting else { return }
      let point = gesture.location(in: self)
      switch gesture.state {
      case .began: model.begin(point, in: self)
      case .changed: model.paint(point, in: self)
      case .ended: model.end()
      case .cancelled, .failed: model.cancel()
      default: break
      }
    }
  }
  private struct ModelSurface: UIViewRepresentable {
    let model: ScanScene
    func makeUIView(context: Context) -> PaintSceneView {
      let view = PaintSceneView()
      view.model = model
      view.scene = model.scene
      view.pointOfView = model.camera
      view.configure()
      view.antialiasingMode = .multisampling4X
      return view
    }
    func updateUIView(_ view: PaintSceneView, context: Context) {
      view.allowsCameraControl = !model.painting
      view.paintGesture?.isEnabled = model.painting
      view.tapGesture?.isEnabled = model.painting
    }
  }
#else
  private final class PaintSceneView: SCNView {
    var model: ScanScene?
    override func mouseDown(with event: NSEvent) {
      if let model, model.painting {
        model.begin(convert(event.locationInWindow, from: nil), in: self)
      } else {
        super.mouseDown(with: event)
      }
    }
    override func mouseDragged(with event: NSEvent) {
      if let model, model.painting {
        model.paint(convert(event.locationInWindow, from: nil), in: self)
      } else {
        super.mouseDragged(with: event)
      }
    }
    override func mouseUp(with event: NSEvent) {
      if let model, model.painting { model.end() } else { super.mouseUp(with: event) }
    }
  }
  private struct ModelSurface: NSViewRepresentable {
    let model: ScanScene
    func makeNSView(context: Context) -> PaintSceneView {
      let view = PaintSceneView()
      view.model = model
      view.scene = model.scene
      view.pointOfView = model.camera
      view.antialiasingMode = .multisampling4X
      return view
    }
    func updateNSView(_ view: PaintSceneView, context: Context) {
      view.allowsCameraControl = !model.painting
    }
  }
#endif

struct ScanModelView: View {
  let scan: FaceScan
  let layers: [RenderLayer]
  let brush: TryOnView.BrushTarget?
  let onStroke: ([StrokePoint]) -> Void
  @StateObject private var model = ScanScene()
  @State private var wire = false
  @State private var move = false
  @State private var failed = false
  @State private var blink = 0.0
  @State private var mouth = 0.0
  @State private var tick = 0
  @State private var lastPaint = Date.distantPast
  @State private var renderJob: UUID?
  @State private var pendingPaint = false
  private var revision: String {
    scan.id
      + layers.map {
        "\($0.paintID ?? $0.cacheKey ?? "")-\($0.color)-\($0.intensity)-\($0.finish)-\($0.opacity)-\(ObjectIdentifier($0.coverage))"
      }.joined() + "-\(tick)"
  }
  var body: some View {
    VStack(spacing: 8) {
      HStack {
        Button("scan.leftView") { model.orient(-0.8) }
        Button("scan.frontView") { model.orient(0) }
        Button("scan.rightView") { model.orient(0.8) }
        Toggle("scan.wire", isOn: $wire).toggleStyle(.button)
        Toggle("scan.rotate", isOn: $move).toggleStyle(.button)
      }.font(.caption).buttonStyle(.borderless)
      ModelSurface(model: model).clipShape(RoundedRectangle(cornerRadius: 12)).frame(minHeight: 180)
      HStack {
        Text("scan.short.blink").font(.caption)
        Slider(value: $blink).disabled(scan.expressions["blink"] == nil)
        Text("scan.short.mouth").font(.caption)
        Slider(value: $mouth).disabled(scan.expressions["mouth"] == nil)
      }
      if failed { Text("scan.feedback.buildError").font(.caption).foregroundStyle(.red) }
    }
    .onAppear {
      model.load(scan)
      configure()
    }
    .onChange(of: scan.id) { _, _ in
      model.cancel()
      model.load(scan)
      configure()
    }
    .onChange(of: brush?.productID) { _, _ in
      model.cancel()
      configure()
    }
    .onChange(of: brush?.radius) { _, _ in configure() }
    .onChange(of: brush?.flow) { _, _ in configure() }
    .onChange(of: move) { _, _ in
      model.cancel()
      configure()
    }
    .onChange(of: wire) { _, _ in model.geometry(blink: blink, mouth: mouth, wire: wire) }
    .onChange(of: blink) { _, _ in model.geometry(blink: blink, mouth: mouth, wire: wire) }
    .onChange(of: mouth) { _, _ in model.geometry(blink: blink, mouth: mouth, wire: wire) }
    .task(id: revision) { await updateTexture() }
    .onDisappear { model.cancel() }
  }
  private func configure() {
    model.brush = brush
    model.moving = move
    model.onStroke = onStroke
    model.onDirty = {
      if renderJob != nil { pendingPaint = true; return }
      if Date.now.timeIntervalSince(lastPaint) > 0.15 {
        lastPaint = .now
        tick += 1
      }
    }
  }
  private func updateTexture() async {
    let id = UUID()
    renderJob = id
    defer {
      if renderJob == id {
        renderJob = nil
        if pendingPaint && !Task.isCancelled { pendingPaint = false; tick += 1 }
      }
    }
    do {
      try await Task.sleep(for: .milliseconds(80))
      if layers.isEmpty {
        let job = Task.detached { try ScanAtlas.bake(scan) }
        let image = try await withTaskCancellationHandler { try await job.value } onCancel: { job.cancel() }
        try Task.checkCancellation()
        model.texture(image); model.coating(nil)
        return
      }
      guard let renderer = MakeupRenderer() else { throw ScanError.image }
      var images: [CGImage] = []
      let live = layers.map { layer in
        var copy = layer
        copy.surfaceMode = true
        if layer.paintID == brush?.productID, let coverage = brush?.layer.coverage { copy.coverage = coverage }
        return copy
      }
      for frame in scan.frames {
        try Task.checkCancellation()
        guard let image = ScanImage.decode(frame.image) else { throw ScanError.image }
        let landmarks = frame.landmarks?.map { CGPoint(x: Double($0.x), y: Double($0.y)) }
        renderer.setPhoto(image, landmarks: landmarks)
        guard let png = renderer.renderForInspection(layers: live)?.pngData(),
          let output = ImageDecoder.decode(png)
        else { throw ScanError.image }
        images.append(output)
      }
      let photos = images
      let job = Task.detached {
        let texture = try ScanAtlas.bake(scan, images: photos)
        let coat = try SurfaceCoating.bake(scan, layers: live)
        return (texture, coat)
      }
      let result = try await withTaskCancellationHandler { try await job.value } onCancel: { job.cancel() }
      try Task.checkCancellation()
      model.texture(result.0); model.coating(result.1)
      failed = false
    } catch is CancellationError {} catch { failed = true }
  }
}
