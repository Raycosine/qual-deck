-- Migration 6: indexes for the lookups the UI does per row.
--
-- Without these the problems list query (one correlated subquery per row for
-- topics, parent topics and PDF paths) full-scans problem_topics (~10k rows)
-- and pdf_files for each of ~1100 problems: measured 12.6s, 0.18s with them.

CREATE INDEX IF NOT EXISTS idx_problem_topics_problem ON problem_topics(pid, course_id);
CREATE INDEX IF NOT EXISTS idx_problem_topics_node    ON problem_topics(topic_node_id);
CREATE INDEX IF NOT EXISTS idx_topic_nodes_parent     ON topic_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_topic_nodes_course     ON topic_nodes(course_id, level);
CREATE INDEX IF NOT EXISTS idx_pdf_files_exam         ON pdf_files(exam_id, kind, source_library_id);
CREATE INDEX IF NOT EXISTS idx_problems_exam          ON problems(exam_id, source_library_id);
CREATE INDEX IF NOT EXISTS idx_attempts_problem       ON attempts(pid, course_id);
CREATE INDEX IF NOT EXISTS idx_attempts_created       ON attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_list_items_problem     ON list_items(pid, course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exam          ON exam_sessions(exam_id, source_library_id);
CREATE INDEX IF NOT EXISTS idx_session_intervals      ON exam_session_intervals(session_id);
CREATE INDEX IF NOT EXISTS idx_session_results        ON exam_session_problem_results(session_id);
CREATE INDEX IF NOT EXISTS idx_problem_notes_kind     ON problem_notes(kind);

ANALYZE;
