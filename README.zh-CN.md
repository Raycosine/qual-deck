# QualDeck

[English](README.md) | **中文**

管理记录历年 qualifying exam 试题的做题记录，并根据间隔重复算法提醒复习。

基于 Tauri v2、React、TypeScript 和 SQLite 构建。

## 功能

- 按考试、课程或知识点浏览题目
- 内置 PDF 阅读器，查看题目和答案
- 记录每次尝试：独立做出 / 看了答案、用时、掌握程度
- 间隔重复复习队列，支持系统通知
- 学习进度面板和总览热力图
- 学习记录导出 / 导入（JSON）
- 中英文界面

## 下载

在 [Releases](../../releases) 下载 Windows 安装包。安装包未签名，Windows SmartScreen 可能会提示风险，点 **更多信息 → 仍要运行** 即可。

## 题库文件夹（Source library）

首次启动时，QualDeck 会让你选择一个**题库文件夹**。应用只读取该文件夹，学习记录单独保存在 SQLite 数据库中。

```text
source-library/
├── json/          # 每场考试一个分类文件，如 fa00.json（必需）
├── exams/         # 试卷 PDF，如 540-fa00.pdf
├── solutions/     # 答案 PDF，如 540-fa00-sol.pdf
├── pdfs/          # 可选：试卷和答案混放，按文件名自动识别
├── taxonomies/    # <课程>_topics.md 知识点树
└── schemas/       # 分类文件的 JSON schema
```

PDF 通过文件名中的 `fa`/`sp` + 年份（`fa00`、`Sp23`、`Fall 2025` 等）匹配到对应考试。

[`source-sample/`](source-sample) 为只包括 Fall 2000 Geometry / Topology 的示例题库，仅供试用。题目与题解来源 [Past Exam Papers](https://dornsife.usc.edu/mathematics/past-exam-papers/)，版权归属原作者所有。

## 从源码构建

需要：[Node.js](https://nodejs.org/) 20+、[Rust](https://rustup.rs/)，以及对应系统的 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
cd app
npm install
npm run tauri dev     # 开发模式运行
npm run tauri build   # 打包，安装包输出到 src-tauri/target/release/bundle/
```

## 目录结构

```text
app/             Tauri + React 应用
source-sample/   示例题库（一场考试）
```

## AI 使用说明

- 本应用的代码借助 Claude Code（Claude Opus 5、Claude Opus 5.5）编写。
- `json/` 中的课程和知识点分类（包括示例题库）由大语言模型生成，可能有误，请以原始 PDF 为准。
