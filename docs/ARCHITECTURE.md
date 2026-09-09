# MakeUp 技术架构与文件地图

MakeUp 包含 Web、iPhone 和 Mac 客户端，核心工作是本地人脸采集、外观预览与试妆。Firebase 提供账号、产品和配方，不负责生成模型。高精度整头重建服务尚未接入。

## 一条数据如何流经系统

```text
摄像头 → 原始视频 → 后台检测与候选帧 → IndexedDB → .makeupcapture
                                                     （原始素材）
照片 / 旧扫描包 → 几何与纹理 → 3D 查看 / 妆容渲染 → 本地图片 / GLB

真实 iPhone → ARKit / TrueDepth → 本地扫描包 → 原生或 Web 查看

Firebase Auth → 账号
Firestore     → 产品目录、用户资料、妆容配方
```

形状由几何决定，肤色和眉毛等外观由纹理承载，光泽由材质描述。提高图片分辨率不能凭空增加真实耳部结构；增加模板三角形数量也不代表测量精度提高。

## 技术栈

版本范围来自源码配置，精确 Web 依赖由锁文件固定。

| 层次 | 技术 | 用途 |
|---|---|---|
| Web 界面 | React 19、TypeScript 6、React Router 8 | 路由、交互与状态 |
| Web 构建 | Vite 8、手写 CSS | 开发、构建与响应式布局 |
| 采集 | getUserMedia、MediaRecorder、Canvas | 视频、图像及生命周期 |
| 人脸定位 | MediaPipe Tasks Vision、Web Worker | 关键点、姿态、表情与选帧 |
| Web 3D / 试妆 | Three.js、WebGL、GLSL | 模型、遮罩、纹理融合、材质和画笔 |
| 本地文件 | IndexedDB/idb、fflate、heic-to | 浏览器存储、ZIP、HEIC 解码 |
| Apple | Swift 6、SwiftUI、ARKit、AVFoundation | 原生界面和 iPhone 采集 |
| Apple 图像与显示 | Vision、Core Image、SceneKit、Metal | 图像分析、3D 与试妆 |
| 后端服务 | Firebase Auth、Firestore | 账号、目录、配方 |
| 工程与测试 | XcodeGen、Swift Package Manager、Playwright、Swift Testing、oxlint | 构建与验证 |

Apple 最低目标为 iOS 17 / macOS 14。硬件、签名和 TrueDepth 能力仍需独立满足；系统版本满足不代表传感器可用。

## 按功能找文件

下面路径都相对于仓库根目录。

| 功能 | 入口与核心文件 |
|---|---|
| Web 路由 | `web/src/App.tsx`，`/capture` 不经过登录保护 |
| 新采集页面 | `web/src/features/head-capture/CapturePage.tsx` |
| 连续录像 / 相机释放 | 同目录 `recording.ts` |
| 清晰度、姿态、候选去重 | 同目录 `selection.ts` |
| 新素材本地存储 / ZIP | 同目录 `captureStore.ts`、`captureArchive.ts` |
| MediaPipe Worker | `web/src/features/face-scan/detector.worker.ts` |
| 旧粗脸采集 / 几何 | 同目录 `GuidedCapture.tsx`、`scanProtocol.ts`、`reconstruction.ts` |
| 旧扫描格式 / 存储 | 同目录 `scanModel.ts` |
| 纹理混合 | 同目录 `atlasBlend.ts`、`atlas.worker.ts`、`scanAppearance.ts` |
| 3D 模型与涂层 | 同目录 `ModelViewer.tsx`、`surfaceMaterial.ts` |
| 照片对照 | 同目录 `CaptureReference.tsx`；这是照片视图，不是完整头部 |
| Web 试妆引擎 | `web/src/features/render-engine/` 中的 `webglCompositor.ts`、`photoMasks.ts`、`paintLayer.ts`、`shaders/` |
| 工作台与配方 | `web/src/features/studio/StudioPage.tsx`、`useTryOnSession.ts`、`LooksPanel.tsx` |
| 账号与目录 | `web/src/features/auth/`、`catalog/`、`web/src/lib/firestore/` |
| 本地照片库 | `web/src/lib/localPhotoStore.ts` |
| 版本和本机服务诊断 | `web/src/components/LocalStatus.tsx`、`web/scripts/local-diagnostics.ts` |
| Apple App | `apple/MakeUpApp/MakeUpApp.swift`、`Views/`、`Studio/` |
| iPhone 采集 | `apple/MakeUpApp/Scan/ARFaceCapture.swift`、`ARDepthReader.swift` |
| 原生模型显示 | 同目录 `ScanModelView.swift`、`ScanPanel.swift` |
| Apple 共享核心 | `apple/Packages/MakeUpCore/Sources/MakeUpCore/` |
| 深度与扫描算法 | 共享核心中的 `Scan/`：表面融合、深度归档、纹理与格式 |
| Metal 试妆 | 共享核心中的 `Render/MakeupRenderer.swift`、`MakeupShaders.metal` |
| 跨端材质 | `shared/materials.json`、`scripts/materials/sync.mjs` |
| 模型研究工具 | `scripts/model-eval/`：预检和基准 CLI，不是运行中的业务后端 |
| 防误公开检查 | `scripts/security/`、`.github/workflows/ci.yml` |

## 采集、保存、重建是三个阶段

新版 `/capture` 保存全段视频；检测失败只影响当前候选帧，不丢弃视频。候选姿态数量不是耳发覆盖，也不是模型质量。`.makeupcapture` 的状态固定为 `not-run`。

旧 Web 模型以 468 点 MediaPipe 脸部几何为基础；ARKit 提供的面部网格也不等于完整头部。原始 TrueDepth 路线尝试融合传感器真正测到的可见表面，但缺少完整真人质量验收。

原视频、深度、纹理和关键点不进入 Firestore。Firestore 可以保存用户资料与配方，仍属于需要权限保护的数据。文件格式与生命周期详见 [连续采集说明](CONTINUOUS_CAPTURE.md)。

## 跨端约定

- 文件 UV 的 V 轴向上，照片像素坐标 Y 向下；显示适配必须显式处理差异。
- ARKit 竖屏图像的旋转必须同步用于投影与姿态，不能只旋转图片。
- 肤色纹理与涂层/粗糙度分开处理；纹理仍可能保留拍摄光照，当前不是完整去光照材质恢复。
- 共享材质使用同步脚本维护。Web 与 Apple 有各自 GPU 实现，需要分别检查输出。
- 原始深度失败不能用粗模板替换后再标为实测。新拓扑不能直接套用旧拓扑的表情数组。

## 本地、云端和构建

默认使用 `demo-makeup` 模拟器。Web 读取显式 Firebase 配置后才连接相应项目；Apple 读取本地 `GoogleService-Info.plist`。这些配置只在个人本机保存。

Vite 从源码内容生成页面版本，已载入页面在 HMR 后仍保留原版本，提醒刷新确认。诊断端点只探测本机固定服务，不查询账号；生产构建会删除 `dist/dev`。

`.gitignore` 与公开审计排除真实图片、扫描导出、权重、设备签名、模拟器数据和私人工作记录。测试需要自己准备素材，详见 [测试指南](TESTING.md)。
