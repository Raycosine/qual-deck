-- Migration 2: Make (pid, course_id) the composite primary key in problems and
-- problem_state, and add a difficulty column to problem_state for FSRS.
--
-- Strategy: back up child tables using explicit INSERT (not CREATE AS SELECT, which
-- is not reliably supported by all migration runners), recreate parent tables, restore.

-- ── 1. Back up child tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _m2_problem_topics (
    id INTEGER, pid TEXT, course_id TEXT, topic_node_id INTEGER,
    topic_name TEXT, topic_kind TEXT
);
INSERT OR IGNORE INTO _m2_problem_topics
    SELECT id, pid, course_id, topic_node_id, topic_name, topic_kind
    FROM problem_topics;
DROP TABLE IF EXISTS problem_topics;

CREATE TABLE IF NOT EXISTS _m2_problem_pdf_links (
    id INTEGER, pid TEXT, pdf_file_id INTEGER,
    page_start INTEGER, page_end INTEGER, link_kind TEXT
);
INSERT OR IGNORE INTO _m2_problem_pdf_links
    SELECT id, pid, pdf_file_id, page_start, page_end, link_kind
    FROM problem_pdf_links;
DROP TABLE IF EXISTS problem_pdf_links;

CREATE TABLE IF NOT EXISTS _m2_attempts (
    id INTEGER, pid TEXT, course_id TEXT,
    started_at TEXT, ended_at TEXT, duration_seconds INTEGER,
    attempt_mode TEXT, outcome TEXT, mastery INTEGER,
    path_quality TEXT, used_solution INTEGER, notes TEXT, created_at TEXT
);
INSERT OR IGNORE INTO _m2_attempts
    SELECT id, pid, course_id, started_at, ended_at, duration_seconds,
           attempt_mode, outcome, mastery, path_quality, used_solution,
           notes, created_at
    FROM attempts;
DROP TABLE IF EXISTS attempts;

CREATE TABLE IF NOT EXISTS _m2_problem_state (
    pid TEXT, course_id TEXT, current_mastery INTEGER, stability REAL,
    last_attempt_at TEXT, next_review_at TEXT, total_attempts INTEGER,
    total_duration_seconds INTEGER, last_outcome TEXT, last_attempt_mode TEXT,
    manually_scheduled INTEGER
);
INSERT OR IGNORE INTO _m2_problem_state
    SELECT pid, course_id, current_mastery, stability,
           last_attempt_at, next_review_at, total_attempts,
           total_duration_seconds, last_outcome, last_attempt_mode,
           manually_scheduled
    FROM problem_state;
DROP TABLE IF EXISTS problem_state;

-- ── 2. Recreate problems with composite primary key ──────────────────────────

CREATE TABLE problems_new (
    pid TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    problem_number INTEGER,
    secondary_course_id TEXT,
    course_confidence REAL,
    topic_confidence REAL,
    problem_statement TEXT,
    evidence TEXT,
    needs_review BOOLEAN DEFAULT 0,
    review_reason TEXT,
    additional_topic_suggestion TEXT,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (pid, course_id)
);
INSERT OR IGNORE INTO problems_new
    SELECT pid, exam_id, course_id, problem_number, secondary_course_id,
           course_confidence, topic_confidence, problem_statement, evidence,
           needs_review, review_reason, additional_topic_suggestion,
           imported_at, updated_at
    FROM problems;
DROP TABLE problems;
ALTER TABLE problems_new RENAME TO problems;

-- ── 3. Recreate problem_state with composite PK + difficulty ─────────────────

CREATE TABLE problem_state (
    pid TEXT NOT NULL,
    course_id TEXT NOT NULL,
    current_mastery INTEGER DEFAULT 0,
    stability REAL DEFAULT 0,
    difficulty REAL DEFAULT 0,
    last_attempt_at DATETIME,
    next_review_at DATETIME,
    total_attempts INTEGER DEFAULT 0,
    total_duration_seconds INTEGER DEFAULT 0,
    last_outcome TEXT,
    last_attempt_mode TEXT,
    manually_scheduled BOOLEAN DEFAULT 0,
    PRIMARY KEY (pid, course_id)
);
INSERT OR IGNORE INTO problem_state
    SELECT pid, course_id, current_mastery, stability, 0,
           last_attempt_at, next_review_at, total_attempts,
           total_duration_seconds, last_outcome, last_attempt_mode,
           manually_scheduled
    FROM _m2_problem_state;
DROP TABLE _m2_problem_state;

-- ── 4. Restore child tables (no FK constraints to avoid migration-time issues) ─

CREATE TABLE problem_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    course_id TEXT NOT NULL,
    topic_node_id INTEGER,
    topic_name TEXT NOT NULL,
    topic_kind TEXT
);
INSERT OR IGNORE INTO problem_topics
    SELECT id, pid, course_id, topic_node_id, topic_name, topic_kind
    FROM _m2_problem_topics;
DROP TABLE _m2_problem_topics;

CREATE TABLE attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    course_id TEXT NOT NULL,
    started_at DATETIME,
    ended_at DATETIME,
    duration_seconds INTEGER,
    attempt_mode TEXT,
    outcome TEXT,
    mastery INTEGER,
    path_quality TEXT,
    used_solution BOOLEAN,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO attempts
    SELECT id, pid, course_id, started_at, ended_at, duration_seconds,
           attempt_mode, outcome, mastery, path_quality, used_solution,
           notes, created_at
    FROM _m2_attempts;
DROP TABLE _m2_attempts;

CREATE TABLE problem_pdf_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    pdf_file_id INTEGER NOT NULL,
    page_start INTEGER,
    page_end INTEGER,
    link_kind TEXT
);
INSERT OR IGNORE INTO problem_pdf_links
    SELECT id, pid, pdf_file_id, page_start, page_end, link_kind
    FROM _m2_problem_pdf_links;
DROP TABLE _m2_problem_pdf_links;
