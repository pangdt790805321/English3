# EHS-AI 智能应用平台（安全行业 AI 平台）

> 让每一条隐患都有标准依据

在线访问：**https://pangdt790805321.github.io/English3/**

## 平台板块

| 板块 | 说明 | 入口 |
|---|---|---|
| ① 拍照识隐患 | 拍照 AI 识别 / 手动登记隐患，关联标准条文，生成检查报告，整改闭环台账 | `/prototype/home.html` |
| ② 规范标准查询 | 134 条 / 18 类条文（GB/JGJ/GBZ/TSG/法规条例及 OSHA/ISO 对照）检索、法域+分类双筛选、引用夹 | `/prototype/search.html` |
| ③ 安全专家修炼库 | 12 册深度学习手册 + 12 张 A4 检查表 + 18 个月路线，进度打卡 | `/prototype/academy.html` |
| ④⑤ 板块四/五 | 规划中（候选：MSDS、案例库、注安题库、企业看板） | — |
| 个人中心 | 法规包管理、我的检查/报告/引用夹 | `/prototype/profile.html` |
| 数据看板 | 使用统计（本机 + 全站） | `/admin.html` |

## 使用说明

- 全部功能在浏览器本地运行，检查数据保存在访问者自己的浏览器（隐私设计），无需登录。
- AI 识别为可选功能（BYOK）：在拍照页填入智谱开放平台 API Key（`glm-4v-flash` 免费）即可；不填 Key 时可手动登记隐患，其余功能完整可用。
- 修炼库手册（docx）与检查表可直接下载。

## 管理员：查看大家的使用情况

打开 `admin.html`（数据看板）。要看全站访问者的统计：按页面提示 3 步接入免费的 GoatCounter（注册 → 把统计域名填入 `analytics-config.js` → 推送），即可看到总访问量、各板块使用次数、地区与趋势。

## 本地运行（可选）

```bash
python -m http.server 8642        # 平台 http://localhost:8642
cd demo && python server.py       # AI 代理（可选，直连也可用）
```

## 目录结构

```
index.html            平台首页（板块导航）
admin.html            数据看板
analytics-config.js   全站统计配置
prototype/            中文版 App（工作台/拍照/结果/台账/报告/修炼库/个人中心…）
library/              安全专家修炼库文档（12 册手册+检查表）
demo/                 真实 AI 识别 Demo（BYOK）
```
