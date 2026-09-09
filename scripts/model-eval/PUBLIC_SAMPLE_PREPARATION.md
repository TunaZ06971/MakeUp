# 公共多角度样例：准备责任、核查结果与实际缺项

更新：2026-09-08。**样例查找、许可核查、选帧、整理清单由开发侧完成，不要求用户自己找照片或制作 JSON。** 用户提供 API 入口并不等于公共样例已经准备完毕。

## 本次核查的两个优先来源

| 来源 | 同人多角度依据 | 使用范围证据 | 当前状态 |
| --- | --- | --- | --- |
| KeenTools 官方 FaceBuilder / FaceTracker 示例 | 官方提供头部建模与跟踪的完整案例包；尚未下载逐帧核验 | 示例页允许跨插件使用其中资产，同时明确“only for educational purposes” | 未把产品基准测试及 Cloud API 上传解释为已经获准；未下载、未上传 |
| FastAvatar 官方随附的 NeRSemble 样例 | 推理脚本给出 `nersemble_seq_214.mp4`；数据集按 participant / sequence / camera 组织，适合固定同一人选视角 | NeRSemble 官方数据与 benchmark 都要求申请访问、批准后取得下载链接；FastAvatar 资产目录的 MIT 标签不能替代上游数据授权 | 未取得本次用途与第三方处理的明确许可，未下载数据包或核验该片段 |

证据：[KeenTools 官方示例与使用范围](https://keentools.io/help/examples)、[FastAvatar 官方样例入口](https://github.com/TyrionWuYue/FastAvatar/blob/bc115c761c542ad7ec1a44c232c57d94b0184961/scripts/infer/infer.sh)、[NeRSemble 官方数据获取要求](https://github.com/tobias-kirschstein/nersemble-data/blob/main/README.md#2-data-access--setup)、[NeRSemble 官方 benchmark 获取要求](https://github.com/tobias-kirschstein/nersemble-benchmark/blob/main/README.md#1-data-access--setup)。

**结果：本轮没有得到一套能够如实标为 `reviewed-public-sample`、可直接上传 KeenTools 的同人多角度真人素材。** 这是素材授权和验证缺项，不能用仓库已有私人人像、从论文截出的照片、或者未经核验的模型示例冒充。没有为了补齐清单而创建假的 SHA-256、来源或许可。

LAM 在线演示的自带单图与他人的动作驱动只适合检查该演示能否执行，不能把输入人像和动作视频中的不同人拼成同人多视角样例。其单次失败也不证明模型本身的重建质量差。

## 明确的后续准备方法

优先争取 **KeenTools 自己的示例用于 KeenTools Cloud 的产品评估许可**，这样无需再增加另一套模型数据账户。开发侧核对用途时需要明确：选择同一人的 3–5 张图片、只测试一次 Cloud API、下载结果到本机、不将示例人物用作 MakeUp 宣传或训练集。未向供应商发送消息，也未代用户接受条款。

如果能取得符合该用途的素材与许可，开发侧按照以下固定步骤准备；不转交用户操作：

1. 把原始下载页面、具体包地址、许可页面或明确的授权记录放进 `.artifacts/model-eval/public-sample/provenance/`。记录核查日期和允许的处理供应商。
2. 验证素材属于同一人物、同一采集场次；从该场次选择正面、舒适的小侧面、较大侧面。若是同步多相机数据，固定同一 participant、sequence、timestamp，只改变 camera；不能混入其他人物或不同年龄的图片。
3. 先做 **3 图** 对照：完整头顶与侧边、清晰无运动模糊、表情尽量中性。仅一側输入就标一侧覆盖，不能因原始包有整圈数据而向算法多喂额外视角，扭曲本产品自拍限制下的结果。
4. 保留原始图片，任何抽帧/尺寸变换另存并记录。不要美颜、换脸或生成未观测侧面作为“真实输入”。
5. 为最终选定文件计算 SHA-256，按本目录 README 的版本 1 结构生成 `public-sample.json`，逐项填入真实来源和许可 URL。
6. 先运行下方 dry-run。只有素材、许可、账号实际额度都已就绪，才使用 README 中的显式执行命令。现有脚本不会替代身份一致性和许可审查。

```bash
python3 scripts/model-eval/keentools_benchmark.py \
  --manifest .artifacts/model-eval/public-sample/public-sample.json
```

本轮没有发送付费请求，也未下载或处理任何私人仓库照片。这份说明标明真实缺项；它本身不是一个已可运行的真人样例包。
