# QualDeck

**English** | [中文](README.zh-CN.md)

A local desktop app for preparing for math qualifying exams with spaced repetition. Built with Tauri v2, React, TypeScript and SQLite.

QualDeck imports past exam problems (classified into courses and topics as JSON), links them to the original exam and solution PDFs, and helps you track attempts and schedule reviews. All data stays on your machine.

## Features

- Browse problems by exam, course or topic
- Built-in PDF viewer for questions and solutions
- Log attempts: solved / read solution, time spent, mastery
- Spaced-repetition review queue with notifications
- Progress dashboard and overview heatmap
- Export / import study records as JSON
- English and Chinese UI

## Download

Get the Windows installer from [Releases](../../releases). The build is unsigned, so Windows SmartScreen may warn you — choose **More info → Run anyway**.

## Source library

On first launch, QualDeck asks for a **source library** folder. The app only reads from it; your study records are kept in a separate SQLite database.

```text
source-library/
├── json/          # one classification file per exam, e.g. fa00.json (required)
├── exams/         # question PDFs, e.g. 540-fa00.pdf
├── solutions/     # solution PDFs, e.g. 540-fa00-sol.pdf
├── pdfs/          # optional: mixed question/solution PDFs, detected by filename
├── taxonomies/    # <course>_topics.md topic trees
└── schemas/       # JSON schema for the classification files
```

PDFs are matched to exams by a `fa`/`sp` + year pattern in the filename (`fa00`, `Sp23`, `Fall 2025`, …).

[`source-sample/`](source-sample) is a minimal working library with one exam (Fall 2000). The sample PDFs from [Past Exam Papers](https://dornsife.usc.edu/mathematics/past-exam-papers/) are included for demonstration only and are not covered by the MIT license. Point the app at it to try things out.

## Build from source

Prerequisites: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
cd app
npm install
npm run tauri dev     # run in development
npm run tauri build   # build installers into src-tauri/target/release/bundle/
```

## Project layout

```text
app/             Tauri + React application
source-sample/   sample source library (one exam)
```
