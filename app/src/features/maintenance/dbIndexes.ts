import { execute, select } from '../../lib/db';

/**
 * The indexes the UI depends on. Migration 06 creates them; this is the manual
 * safety net for databases where that migration never ran (e.g. a file copied
 * from an older install).
 */
const INDEXES: [string, string][] = [
  ['idx_problem_topics_problem', 'CREATE INDEX IF NOT EXISTS idx_problem_topics_problem ON problem_topics(pid, course_id)'],
  ['idx_problem_topics_node', 'CREATE INDEX IF NOT EXISTS idx_problem_topics_node ON problem_topics(topic_node_id)'],
  ['idx_topic_nodes_parent', 'CREATE INDEX IF NOT EXISTS idx_topic_nodes_parent ON topic_nodes(parent_id)'],
  ['idx_topic_nodes_course', 'CREATE INDEX IF NOT EXISTS idx_topic_nodes_course ON topic_nodes(course_id, level)'],
  ['idx_pdf_files_exam', 'CREATE INDEX IF NOT EXISTS idx_pdf_files_exam ON pdf_files(exam_id, kind, source_library_id)'],
  ['idx_problems_exam', 'CREATE INDEX IF NOT EXISTS idx_problems_exam ON problems(exam_id, source_library_id)'],
  ['idx_attempts_problem', 'CREATE INDEX IF NOT EXISTS idx_attempts_problem ON attempts(pid, course_id)'],
  ['idx_attempts_created', 'CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts(created_at)'],
  ['idx_list_items_problem', 'CREATE INDEX IF NOT EXISTS idx_list_items_problem ON list_items(pid, course_id)'],
  ['idx_sessions_exam', 'CREATE INDEX IF NOT EXISTS idx_sessions_exam ON exam_sessions(exam_id, source_library_id)'],
  ['idx_session_intervals', 'CREATE INDEX IF NOT EXISTS idx_session_intervals ON exam_session_intervals(session_id)'],
  ['idx_session_results', 'CREATE INDEX IF NOT EXISTS idx_session_results ON exam_session_problem_results(session_id)'],
  ['idx_problem_notes_kind', 'CREATE INDEX IF NOT EXISTS idx_problem_notes_kind ON problem_notes(kind)'],
];

export interface IndexDiagnostics {
  expected: number;
  presentBefore: number;
  created: string[];
  failed: string[];
  elapsedMs: number;
}

export async function ensureIndexes(): Promise<IndexDiagnostics> {
  const started = performance.now();
  const existing = new Set(
    (await select<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`))
      .map(r => r.name)
  );

  const created: string[] = [];
  const failed: string[] = [];
  for (const [name, sql] of INDEXES) {
    if (existing.has(name)) continue;
    try {
      await execute(sql);
      created.push(name);
    } catch (err) {
      console.error(`Failed to create ${name}:`, err);
      failed.push(name);
    }
  }
  await execute('ANALYZE').catch(() => {});

  return {
    expected: INDEXES.length,
    presentBefore: INDEXES.filter(([name]) => existing.has(name)).length,
    created,
    failed,
    elapsedMs: Math.round(performance.now() - started),
  };
}
