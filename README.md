# 北京旅游景点预约入口汇总

北京主要旅游景点的**预约入口**汇总，构建为一个**单文件、零依赖**的交互式 HTML 页面。

- 🔗 在线预览：<https://beijingattractions.netlify.app>
- 📄 页面标题：**北京旅游景点预约入口汇总**

## 内容

按 7 个类别组织景点：

1. 皇家园林与历史古迹
2. 博物馆与展览馆
3. 科技与艺术场馆
4. 公园与自然景观
5. 宗教寺庙与文化场所
6. 胡同街区与文创园区
7. 演出与夜游项目

每个景点包含：所在区、类别、标签、预约渠道类型与名称、预约入口、相关链接、开放时间、参观规则、票价、预约难度、备注、核实状态与可信度等字段。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | **构建产物**（单文件页面，可直接双击打开或部署到任意静态托管） |
| `template.html` | 页面模板 |
| `data.tsv` | 数据源（制表符分隔，16 字段） |
| `build.mjs` | 校验数据并生成页面（含类别 / 标签 / 渠道白名单校验） |
| `makedata.mjs` | 数据整理与生成脚本 |
| `verify.mjs` | 数据校验脚本 |

## 构建

```bash
node build.mjs
```

> `build.mjs` 默认输出到**上级目录**的 `北京旅游景点预约入口汇总.html`；本仓库根目录的 `index.html` 即为该构建产物。

## 数据字段

`data.tsv` 共 16 列：

```
name  district  category  tags  channelType  channelName  entry  link
hours  rules  price  difficulty  remark  status  confidence  source
```

数据整理时间：2026-09
