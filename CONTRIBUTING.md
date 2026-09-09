# Contributing

感谢帮助 MakeUp 改善本地采集与试妆。提交前请阅读 [README](README.md)、[技术架构](docs/ARCHITECTURE.md) 和 [公开数据边界](docs/PUBLIC_DATA_POLICY.md)。

## 开发约定

1. 从公开仓库新建功能分支，保持改动范围清楚；不要将含私人提交的开发仓库整段历史合并进来。
2. 人像、录像、扫描包、权重和设备签名只留本地。复现问题时使用自行获准的输入，公开 Issue 仅提供脱敏信息。
3. Web/Apple 的公共材质定义位于 `shared/materials.json`。修改后执行同步脚本并检查两端一致性。
4. 几何、纹理、材质和原图对照是不同能力；不要把更细的模板或一段渲染视频说成真实头部几何。
5. 改摄像头行为时验证权限拒绝、关闭轨道、后台中断、保存失败和数据恢复；改渲染时检查实际图像，不能只看断言。
6. `xcodebuild` 串行运行。Simulator 不能替代真实 iPhone ARKit/TrueDepth 验收。

## 提交前

```sh
npm run check:materials
npm --prefix web run lint
npm --prefix web run build
python3 -m unittest discover -s scripts/security -p 'test_*.py'
python3 -m unittest discover -s scripts/model-eval -p 'test_*.py'
```

准备好文件后，按明确路径暂存，再运行 `npm run check:public` 并检查 `git diff --cached`。完整带图片的测试见 [测试指南](docs/TESTING.md)。不要用含真人截图的 CI artifact 补充公共测试。

PR 请写清：解决的问题、可观察行为变化、验证方法、未验证设备或能力。不要将本机私人路径、用户资料或 API key 写进描述。修改已有第三方资产时保留其来源、许可证和修改说明。
