# MakeUp

**本地人脸采集与跨平台虚拟试妆原型。** 让采集更自然，让妆容可以调整、比较和保存。

Local-first head capture and virtual makeup for Web, iPhone and Mac.

[快速开始](#快速开始) · [技术架构](docs/ARCHITECTURE.md) · [采集指南](docs/CONTINUOUS_CAPTURE.md) · [隐私与开源范围](docs/PUBLIC_DATA_POLICY.md) · [参与开发](CONTRIBUTING.md)

> **项目状态：实验性原型。** 网页端能够采集视频、生成和编辑粗略脸部模型；高保真完整头部重建仍在研究中。当前没有准确恢复本人完整发型、耳朵和后脑，也没有经过验证的五分钟生成承诺。

## 可以做什么

- **自然转头采集**：无需登录，连续录像、自动挑选候选帧、回看和补录；不要求转满 90°，检测失败不会清空已录视频。
- **本地数据管理**：照片、录像、关键点与扫描模型保存在设备或浏览器；可以主动导入、导出，不自动上传人脸数据。
- **虚拟试妆**：选择产品、调整浓度、切换质地；支持手动绘制、撤销、重做和妆容配方。
- **3D 脸部工作台**：旋转、缩放、查看纹理，在现有脸部表面上试妆并导出 GLB。
- **Apple 原生实验**：SwiftUI 客户端支持 iPhone/Mac；受支持的真实 iPhone 可使用 ARKit 和原始 TrueDepth 可见表面采集。
- **中英双语**：Web 与 Apple 客户端均提供中文和英文界面。

| 能力 | Web | iPhone | Mac 原生 |
|---|---|---|---|
| 连续录像、自动选帧 | 支持 | 浏览器能力未完成真机验收 | 使用 Web 入口 |
| 粗略脸部模型与试妆 | 支持 | 支持 | 支持导入与查看 |
| 原始 TrueDepth | 不支持 | 实验功能，需要兼容真机 | 支持导入结果 |
| 账号、产品、妆容配方 | Firebase | Firebase | Firebase |
| 完整高保真人头 | 尚未完成 | 尚未完成 | 尚未完成 |

## 快速开始

### 只体验网页采集

需要 **Node.js 22.12+** 和支持摄像头/MediaRecorder 的浏览器。Web 自动化在 Chrome 验证；其他浏览器仍需要设备测试。

```sh
git clone https://github.com/TunaZ06971/MakeUp.git
cd MakeUp
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1
```

打开 **[http://127.0.0.1:5173/capture](http://127.0.0.1:5173/capture)**。无需 Firebase 项目、API key 或 GPU。第一次启动会下载 MediaPipe 模型与运行时；之后人脸检测从同源本地文件加载。

点击“开始录像”，正面稍停，向舒服的一侧慢慢转头，再回正。每段最多约 25 秒，可回看、补录和导出。详见 [连续采集指南](docs/CONTINUOUS_CAPTURE.md)。

### 使用产品库和妆容配方

另外需要 **Java 21+**。在项目根目录安装工具并启动本地 Firebase 模拟器：

```sh
npm ci
npm run emulators
```

保留该终端，另开终端初始化示例产品：

```sh
npm run seed
```

打开 [工作台](http://127.0.0.1:5173)，用虚构测试邮箱注册。默认项目为 `demo-makeup`，不会连接真实 Firebase。正常停止模拟器会将本地账号和配方保存到被 Git 忽略的 `.firebase/`。

示例色号和材质仅用于展示算法，没有经过品牌实测或色彩标定，与所列品牌不存在官方合作关系。

### Apple 客户端

需要 macOS、支持 Swift 6 的 Xcode 和 [XcodeGen](https://github.com/yonaskolb/XcodeGen)。最低部署目标为 iOS 17 / macOS 14；当前工程在 Xcode 26 环境验证过。

```sh
cp apple/project.local.example.yml apple/project.local.yml
# 在 project.local.yml 填写自己的 Team 和唯一 Bundle ID
xcodegen generate --spec apple/project.local.yml
open apple/MakeUp.xcodeproj
```

选择 `MakeUp` scheme 和真实 iPhone，或 `My Mac`。Simulator 无法验证本项目的 ARKit 人脸采集流程。原生登录需要正确签名与钥匙串配置；不要通过关闭签名绕过问题。

iPhone 的 `127.0.0.1` 指向手机自己；可以先用“无需登录 · 本机 3D 采集”，无需配置云服务。完整步骤见 [Apple 采集指南](docs/3D_CAPTURE_GUIDE.md)。

## 项目结构

```text
web/                    React + TypeScript 网页客户端
  src/features/
    head-capture/       连续录像、选帧、本地素材包
    face-scan/          旧粗脸采集、纹理融合、3D 查看
    render-engine/      WebGL 妆容、遮罩和画笔
    auth/ catalog/      账号与产品目录
    studio/             工作台与配方
apple/                  SwiftUI iPhone / Mac 客户端
  Packages/MakeUpCore/   共享模型、Vision、Metal、采集核心
shared/                 两端共同使用的材质预设
scripts/                产品种子、资源生成、模型评估、安全检查
docs/                   架构、采集、测试、隐私和重建边界
```

MediaPipe 负责定位与选帧，Three.js/WebGL 与 SceneKit/Metal 负责显示和妆容，Firebase 只处理账号、产品、配方。它们不能替代尚未接入的高精度头部重建后端。详见 [技术架构](docs/ARCHITECTURE.md)。

## 数据与隐私

**本仓库发布程序，不发布真人素材。** 开源文件不包含人脸照片、录像、深度、扫描包、个人模型、模拟器账号导出或服务密钥。

| 数据 | 默认位置 / 行为 |
|---|---|
| 新采集视频与候选帧 | 当前浏览器 IndexedDB，可导出 `.makeupcapture` |
| 旧脸部扫描、照片、纹理 | 浏览器或 Apple 本地存储，可导出 `.makeupscan` / JSON / GLB |
| 登录与配方 | 默认本机 Firebase 模拟器；配置真实项目后才使用相应服务 |
| 密钥与 Apple 签名配置 | 个人本地文件，不进 Git |

`.makeupcapture` 是**素材容器**，不是模型，不与旧 `.makeupscan` 自动互通。清除站点数据会删除浏览器中的素材；换浏览器或切换 `localhost` / `127.0.0.1` 也会使用不同的存储空间。

详细分类、忽略规则和公开前检查见 [开源数据边界](docs/PUBLIC_DATA_POLICY.md)；漏洞反馈见 [SECURITY.md](SECURITY.md)。

## 开发与验证

```sh
npm run check:materials
npm --prefix web run lint
npm --prefix web run build
python3 -m unittest discover -s scripts/security -p 'test_*.py'
python3 -m unittest discover -s scripts/model-eval -p 'test_*.py'
git add <已经审查的文件>
npm run check:public
```

CI 检查公开文件、Git 文件历史、常见密钥、Web 构建及不依赖真人图片的回归。完整浏览器/渲染测试需要自行准备获准使用的私人夹具，**这些照片不会随仓库提供**。运行方式见 [测试指南](docs/TESTING.md)。

## 接下来要解决什么

- 跑通专用头部重建模型，并实际验证本人相似度、可见耳部和发型。
- 区分已观察区域与模型补全区域，验证从采集到浏览器呈现的总耗时。
- 改善可编辑皮肤和妆容材质，并做真实产品校色。
- 扩大不同设备、光线、姿态与肤色的真人验收。

[重建边界与研究方向](docs/RECONSTRUCTION.md) 会区分“已实现”“实验中”和“尚未验证”。研究脚本默认 dry-run，不会自动购买算力或调用收费服务。

## 许可证

项目原创代码沿用仓库的 **[MIT License](LICENSE)**。第三方代码、规范脸拓扑、模型、解码器和 SDK 各自遵守原许可证；MIT 不会覆盖它们，也不授予真人肖像或品牌资产的使用权。详见 [THIRD_PARTY.md](THIRD_PARTY.md)。
