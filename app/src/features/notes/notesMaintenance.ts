import { select, execute } from '../../lib/db';

export interface NotesDiagnostics {
  tableCreated: boolean;
  problems: number;
  problemsWithSolution: number;
  problemNotesBefore: number;
  solutionNotesBefore: number;
  problemNotesCreated: number;
  solutionNotesCreated: number;
  notesWithText: number;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS problem_notes (
    pid        TEXT NOT NULL,
    course_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pid, course_id, kind)
  )
`;

/**
 * Compatibility pass for databases created before notes existed: make sure the
 * table is there and give every problem (and every problem whose exam ships a
 * solution PDF) a blank note row. Safe to run repeatedly.
 */
export async function repairNotes(): Promise<NotesDiagnostics> {
  const existing = await select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'problem_notes'`
  );
  const tableCreated = existing.length === 0;
  if (tableCreated) {
    await execute(CREATE_TABLE);
    await execute(`CREATE INDEX IF NOT EXISTS idx_problem_notes_lookup ON problem_notes(pid, course_id)`);
  }

  const count = async (sql: string) => (await select<{ n: number }>(sql))[0]?.n ?? 0;

  const problems = await count(`SELECT COUNT(*) AS n FROM problems`);
  const problemsWithSolution = await count(`
    SELECT COUNT(*) AS n FROM problems p
    WHERE EXISTS (
      SELECT 1 FROM pdf_files pf
      WHERE pf.exam_id = p.exam_id AND pf.kind = 'solution'
        AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
    )
  `);
  const problemNotesBefore = await count(`SELECT COUNT(*) AS n FROM problem_notes WHERE kind = 'problem'`);
  const solutionNotesBefore = await count(`SELECT COUNT(*) AS n FROM problem_notes WHERE kind = 'solution'`);

  const problemInsert = await execute(`
    INSERT OR IGNORE INTO problem_notes (pid, course_id, kind, note)
    SELECT p.pid, p.course_id, 'problem', '' FROM problems p
  `);
  const solutionInsert = await execute(`
    INSERT OR IGNORE INTO problem_notes (pid, course_id, kind, note)
    SELECT p.pid, p.course_id, 'solution', '' FROM problems p
    WHERE EXISTS (
      SELECT 1 FROM pdf_files pf
      WHERE pf.exam_id = p.exam_id AND pf.kind = 'solution'
        AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
    )
  `);

  const notesWithText = await count(`SELECT COUNT(*) AS n FROM problem_notes WHERE TRIM(note) <> ''`);

  return {
    tableCreated,
    problems,
    problemsWithSolution,
    problemNotesBefore,
    solutionNotesBefore,
    problemNotesCreated: problemInsert.rowsAffected ?? 0,
    solutionNotesCreated: solutionInsert.rowsAffected ?? 0,
    notesWithText,
  };
}
