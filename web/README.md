# MakeUp Web

React + TypeScript + Vite 客户端。请从 [项目 README](../README.md) 开始。

- `/capture`：无需登录的连续视频采集、选帧和本地保存。
- `/`：需要登录的试妆工作台；默认连接本机 Firebase 模拟器。
- `npm run dev`：准备同源 MediaPipe 资源和许可证后启动开发服务器。
- `npm run build`：类型检查和构建，移除 `dist/dev` 私人开发图片。
- `npm run lint` / `npm test`：静态检查与 Playwright 回归；完整测试需要私人夹具。

`.makeupcapture` 保存原始素材；旧 `.makeupscan` 保存粗略脸部模型。高精度整头后端尚未接入。技术与数据边界见 [架构](../docs/ARCHITECTURE.md) 和 [安全说明](../SECURITY.md)。
