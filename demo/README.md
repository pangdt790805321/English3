# 拍照识隐患 · 真实 API Demo

上传现场照片 → 调用多模态大模型 → 输出结构化隐患清单（风险等级、置信度、建议引用标准、整改建议）。

## 快速开始

1. **获取 API Key**：在 [智谱开放平台](https://open.bigmodel.cn) 注册并创建 Key（`glm-4v-flash` 模型目前免费，适合体验）。
2. **启动本地代理**（Python 3 标准库，无其他依赖）：

   ```bash
   cd demo
   python server.py
   # 或自定义端口：python server.py 9000
   ```

3. **打开页面**：浏览器访问 <http://localhost:8643>
4. 粘贴 API Key → 上传照片 → 点击「开始识别」。

## 工作原理

```
浏览器(index.html) --POST /api/analyze + X-Api-Key--> server.py(本机)
                                                     │ 转发（仅加 Authorization 头）
                                                     ▼
                                        open.bigmodel.cn /chat/completions
                                                     │ 多模态模型(glm-4v 系列)
                                                     ▼
                                     JSON 隐患清单 → 渲染为风险卡片
```

- **BYOK**（Bring Your Own Key）：Key 只存浏览器 localStorage，经本机代理直连官方接口，不经任何第三方服务器，代理也不落盘。
- 浏览器直连官方接口会被 CORS 拦截，因此必须经 `server.py` 访问（页面用 `file://` 打开会显示提示）。
- 修改 `UPSTREAM` 常量即可切换到任何 OpenAI 兼容的多模态服务（如自建网关）。

## 提示词与输出格式

系统提示词要求模型输出严格 JSON 数组：

```json
[{
  "hazard": "隐患描述",
  "risk": "high | medium | low | review",
  "confidence": 0-100,
  "citation_standard": "标准号（不确定必须为 null）",
  "citation_text": "条文关键内容（禁止编造原文）",
  "fix": "整改建议"
}]
```

页面会解析该 JSON 渲染为带风险徽章与置信度的隐患卡片；解析失败或模型拒答时展示原始返回便于调试。

## 与正式产品的差别（重要）

| | 本 Demo | 正式产品 |
|---|---|---|
| 条文来源 | 由大模型生成（**可能幻觉**） | 结构化法规库检索，条文只检索不生成 |
| 置信度 | 模型自评 | 检索匹配分 + 人工复核队列 |
| 输出 | 单次识别 | 检查任务、双语报告、整改闭环 |

**请勿将 Demo 输出直接作为执法或整改依据。**
