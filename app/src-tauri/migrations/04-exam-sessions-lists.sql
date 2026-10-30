-- Course metadata: configurable exam duration per course
ALTER TABLE courses ADD COLUMN exam_length_minutes INTEGER NOT NULL DEFAULT 120;

-- Virtual participation sessions
CREATE TABLE IF NOT EXISTS exam_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id     TEXT    NOT NULL,
  source_library_id INTEGER,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  status      TEXT    NOT NULL DEFAULT 'in_progress',  -- 'in_progress' | 'completed'
  notes       TEXT
);

-- Per-problem time intervals within a session (written in real-time)
CREATE TABLE IF NOT EXISTS exam_session_intervals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  pid         TEXT    NOT NULL,
  course_id   TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
);

-- Per-problem grades collected at session end
CREATE TABLE IF NOT EXISTS exam_session_problem_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL,
  pid         TEXT    NOT NULL,
  course_id   TEXT    NOT NULL,
  mastery     INTEGER,
  outcome     TEXT,
  notes       TEXT,
  UNIQUE(session_id, pid, course_id),
  FOREIGN KEY (session_id) REFERENCES exam_sessions(id)
);

-- User-created named problem lists
CREATE TABLE IF NOT EXISTS problem_lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Items in a list (pid + course_id to match composite PK)
CREATE TABLE IF NOT EXISTS list_items (
  list_id     INTEGER NOT NULL,
  pid         TEXT    NOT NULL,
  course_id   TEXT    NOT NULL,
  added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, pid, course_id),
  FOREIGN KEY (list_id) REFERENCES problem_lists(id)
);
