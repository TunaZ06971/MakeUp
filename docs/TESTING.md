# 测试指南

## 不需要真人素材的检查

在安装根目录和 Web 依赖后：

```sh
npm run check:materials
npm --prefix web run lint
npm --prefix web run build
python3 -m unittest discover -s scripts/security -p 'test_*.py'
python3 -m unittest discover -s scripts/model-eval -p 'test_*.py'
cd web
npx playwright test head-capture.spec.ts --grep 'coverage uses|portable package|misleading stored-entry'
```

最后一条仅运行选帧和归档的纯逻辑测试，不启动真实摄像头，不需要私人照片。CI 使用这些检查，另扫描公开文件及 Git 历史。不会上传渲染截图。

## 完整 Web 回归

需要 Chrome、本机 Firebase 模拟器、初始化的产品目录，以及自己获准使用的以下夹具：

| 本机路径 | 内容 |
|---|---|
| `web/public/dev/face2.jpg` | 光线清楚、适合正脸检测的 JPEG |
| `web/public/dev/face1.heic` | 用于 HEIC 解码的真实有效文件 |

这些文件不随仓库分发。固定像素和姿态测试可能需要根据自行选用的夹具调整基线；不要用假文件替代，再把跳过或失败报成通过。

```sh
npm run emulators
# 另开终端
npm run seed
npm --prefix web test
```

测试使用 `canvas.captureStream` 模拟相机输入，并运行真实 MediaRecorder、MediaPipe Worker 和 GPU 渲染。它可以验证生命周期、导入导出、妆容编辑和持久化，不能验证真人转头的成功率、真实相机曝光或 iPhone 传感器。

输出位于 `.artifacts/`、`web/test-results/` 等忽略目录，可能包含私人图像。不要提交或上传到公共 CI artifact。生产构建会删除 `dist/dev`，仍应检查其他目录是否误放媒体。

## 打包页面录制验证

```sh
npm --prefix web run build
npm --prefix web run preview -- --host 127.0.0.1 --port 5174
# 另开终端
node scripts/tests/capture-preview.mjs
```

验证使用同一份本地 JPEG 作为内存输入，不把它复制到生产目录，不开启物理摄像头。

## Apple

配置本地签名后用 XcodeGen 生成工程，串行运行 `xcodebuild`。图像测试需要 `apple/Tests/Resources/` 中获准使用的本机夹具；完整 Web 测试还可生成跨端扫描夹具。不要把生成物提交到仓库。

```sh
xcodebuild test -project apple/MakeUp.xcodeproj -scheme MakeUp -destination 'platform=macOS'
xcodebuild build -project apple/MakeUp.xcodeproj -scheme MakeUp -destination 'generic/platform=iOS Simulator'
```

没有夹具的跳过不算图像验证通过。Simulator 构建成功不代表 ARKit/TrueDepth 真机采集或高精度头部还原已经通过。
