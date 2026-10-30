-- Migration 5: free-form notes attached to a problem's question PDF and, when
-- one exists, its solution PDF. One row per (pid, course_id, kind).
CREATE TABLE IF NOT EXISTS problem_notes (
    pid        TEXT NOT NULL,
    course_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,           -- 'problem' | 'solution'
    note       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pid, course_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_problem_notes_lookup ON problem_notes(pid, course_id);
