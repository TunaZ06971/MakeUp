# 头部模型评估工具

这里的脚本与网页采集、化妆业务分开。它们不构成高精度重建后端，也不自动部署或购买算力。

## 只读预检

`preflight_lam.py` 仅依赖 Python 标准库：检查本机硬件、已有 LAM 源码中的 CUDA 路径和部分必要资产是否存在。默认不联网、不导入执行 PyTorch、不下载任何权重。

```bash
python3 scripts/model-eval/preflight_lam.py
python3 scripts/model-eval/preflight_lam.py --public-metadata
```

第二条命令读取固定的官方 Hugging Face 文件目录和演示运行状态，输出大小限制为每响应 2 MB。没有图像输入、上传接口或收费接口。

默认源码目录是 `.artifacts/model-eval/LAM`。可以另用 `--lam-repo /path/to/LAM` 指定已下载源码。若需要重新获取官方源码，可手动执行：

```bash
mkdir -p .artifacts/model-eval
git clone --depth 1 https://github.com/aigc3d/LAM.git .artifacts/model-eval/LAM
```

预检的 `readiness=not-validated` 是有意保留的：文件存在和硬件匹配不能证明安装成功、输入许可满足、重建效果合格或速度达标。它不替用户作许可判断。

## 有界的官方公开演示探针

`lam_public_demo_probe.py` 默认只输出 dry-run 计划；添加 `--run-demo` 才会真正调用第三方托管的免费演示一次。它固定使用该演示自己的 `status.png` 和 `Look_In_My_Eyes.mp4`，不接受本地照片、不读取已保存 token、不注册账号、不调用付费 API、不下载返回媒体。若服务要求登录、限流或失败，不自动重试或绕过。

先在隔离目录装官方轻量客户端：

```bash
uv venv .artifacts/model-eval/client-env
uv pip install --python .artifacts/model-eval/client-env/bin/python gradio_client==1.8.0
.artifacts/model-eval/client-env/bin/python scripts/model-eval/lam_public_demo_probe.py --run-demo
```

用独立子进程限制客户端等待为 300 秒。到期结束本机等待，并标记远端是否已取消为未知；不会谎称远端 job 已停止。当前公开 Space 的接口只返回图像和渲染视频，即使调用成功也不会把 `fullPipelineAccepted` 改为 true。

2026-09-08 的实测中，官方 SDK 成功提交自带样例，但上游在 18.32 秒时报错且未提供内部错误细节。不能从这个结果推导成功重建速度。完整证据与后续契约见 [可行性报告](../../docs/RECONSTRUCTION.md)。

## KeenTools 网格几何基线

`keentools_benchmark.py` 是本地命令行客户端，不部署网页服务器。**KeenTools 不还原本人真实发型；这个脚本只建立网格/脸型对照。** LAM/FastAvatar 的完整头像研究不会因此被替换成无头发的网格产品。

默认完全 dry-run：不读取图片、API key，不联网，不预扣费用。

```bash
python3 scripts/model-eval/keentools_benchmark.py
```

真正执行前需要：

1. [KeenTools Cloud 账号](https://cloud.keentools.io/)，在账户中确认实际赠送额度和 API key 可用；不预设必定获赠，不需要先充值。
2. 在本机进程环境设置 `KEENTOOLS_API_KEY`。不要将 key 发进聊天、提交到 Git 或写成 `VITE_` 变量。
3. **开发侧负责**准备 `public-sample.json`，不让用户找素材或填写清单。仅收录使用范围允许这次处理的 2–5 张公共样例，每张记录本地路径、原始来源、许可 URL 和 SHA-256。已优先核查 KeenTools 官方示例和 FastAvatar 随附数据，目前未能确认其可用于这次 Cloud 产品基准；具体证据、阻碍及开发侧准备方法见 [公共样例准备说明](PUBLIC_SAMPLE_PREPARATION.md)。因此仓库没有伪装成已审查的真人样例包。

清单结构如下。`sha256` 要替换为真实文件摘要；相对路径从清单所在目录解析。

```json
{
  "schemaVersion": 1,
  "inputKind": "reviewed-public-sample",
  "images": [
    {
      "path": "front.jpg",
      "sourceUrl": "https://original-source.example/photo",
      "licenseUrl": "https://original-source.example/license",
      "sha256": "REPLACE_WITH_ACTUAL_SHA256"
    },
    {
      "path": "side.jpg",
      "sourceUrl": "https://original-source.example/side-photo",
      "licenseUrl": "https://original-source.example/license",
      "sha256": "REPLACE_WITH_ACTUAL_SHA256"
    }
  ]
}
```

先检查清单，仍不联网：

```bash
python3 scripts/model-eval/keentools_benchmark.py --manifest .artifacts/model-eval/public-sample.json
```

在 key、样例许可和额度确认后，由开发者显式执行：

```bash
python3 scripts/model-eval/keentools_benchmark.py \
  --manifest .artifacts/model-eval/public-sample.json \
  --execute-public-sample \
  --output .artifacts/model-eval/keentools-first
```

预算与错误行为：

- 只允许 2–5 图、无表情、一次 GLB+纹理，按本次官网单价预计最多 $9；价格变化需重新核价后更新，不能当作永久合同上限。
- 默认整个首轮共用 `.artifacts/model-eval/round-budget.json`，文件锁下保守预留 $9，合计超过 $20 就在 API 前拒绝。即使用赠送 credits，也按 $9 占用本轮上限。
- 若已经在其他 GPU/API 花费 $6，执行时加 `--budget-used-elsewhere-usd 6`；该值只增不减。账本只能限制经本工具记录的支出，不能查询其他平台账单或阻止平台外的付款。不要换账本文件绕开上限。
- 网络故障、计算失败和超时保留原费用预留，必须核对供应商账单后再人工处理；不自动退款假设、不自动重提 `process`。
- `get-status` 用于等待计算；结果接口遇到 `retry-after` 才继续。取得首个收费 `redirect` 后立即保存下载地址、停止结果轮询，只下载该地址。后续下载失败不自动重新申请收费结果。
- 300 秒本机计时包括校验、上传、排队、计算、导出和下载；超时会退出等待，但不谎称供应商任务已取消。API key 不转发给上传/下载主机或重定向目标。
- 输出 `head.glb` 和 `receipt.json`。下载完成仍标记为 `asset-downloaded-not-yet-rendered`，不能算浏览器首屏、妆容或完整头发验收通过。
- 执行失败或超时时，KeenTools/LAM 探针均返回非零 CLI 退出码；dry-run 和成功完成该工具所负责的阶段才返回 0。`fullPipelineAccepted=false` 仍需由浏览器与质量验证解决。

离线验证：

```bash
python3 -m unittest discover -s scripts/model-eval -p 'test_*.py'
```

测试覆盖首轮预算（包含其他服务支出）、成功 redirect 后停止轮询、资产主机不接收 key、提交结果不确定时不自动重试、超额图像数拒绝，以及执行失败时返回非零退出码。全部使用本地假 HTTP 响应，没有真实账户、上传或费用。
