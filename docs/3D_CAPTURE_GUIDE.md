# Apple 真机采集指南

原生客户端需要 macOS、支持 Swift 6 的 Xcode、XcodeGen。最低目标为 iOS 17 / macOS 14。ARKit/TrueDepth 采集需要兼容的真实 iPhone，Simulator 无法替代。

## 本机签名

```sh
cp apple/project.local.example.yml apple/project.local.yml
```

在 `project.local.yml` 填入自己的 Apple Development Team 和唯一 Bundle ID，然后：

```sh
xcodegen generate --spec apple/project.local.yml
open apple/MakeUp.xcodeproj
```

这个覆盖文件不会进 Git。共享 `project.yml` 保持通用示例配置；不要把个人 Team、证书或配置文件提交回来。动态钥匙串分组会跟随 Bundle ID；macOS Firebase Auth 需要正确签名，不能用禁用签名验证登录。

## 选择真实运行目标

1. 用数据线连接 iPhone 与 Mac，解锁并信任电脑；根据系统提示开启开发者模式。
2. 在 Xcode 顶部选 `MakeUp` scheme，右侧运行目标选设备列表中的真实 iPhone。
3. 确认显示 `MakeUp > 你的 iPhone`，按 `Command + R`。不要选 Simulator 或 Any iOS Device。
4. 若签名失败，在 Xcode Settings → Accounts 登录自己的 Apple ID，并核对本地覆盖文件中的 Team/Bundle ID。
5. App 中选择“无需登录 · 本机 3D 采集”，允许摄像头权限。

## 采集与导出

让头顶、可见耳朵和下巴都留在取景框中，保持自然表情和均匀光线。原生实验流程与 Web 连续录像不同，仍有姿态/表情引导；侧面跟踪困难时使用跳过入口，不必强行转到看不到屏幕的位置。

原始深度路线仅融合实际测到的可见表面；它没有真实后脑补全、完整发丝、牙齿或隐藏耳内结构，也没有完成高保真人头验收。粗 ARKit 面部网格与测量可见表面会分别标记。

使用 App 的导出按钮将 `.makeupscan` / JSON 保存在自己的设备，可主动传到另一设备查看。素材含有真人原图、几何及可能的深度数据，应放在私人目录，例如被忽略的 `test_faces/`；不要提交 Git、Issue 或 CI 附件。

## Firebase 与网络

无需登录的采集不需要云端账号。iPhone 的 `127.0.0.1` 指向手机自己，不能直接访问 Mac 的模拟器。

需要真实服务时自行提供 `apple/MakeUpApp/GoogleService-Info.plist`，该文件默认忽略；重新生成 Xcode 工程并配置相应账号和数据库规则。Web 采用自己的 `.env.local`。不要把配置缺失误认为采集传感器故障。

Web 新素材包 `.makeupcapture` 目前不能直接导入原生客户端。网页操作见 [连续采集指南](CONTINUOUS_CAPTURE.md)。
