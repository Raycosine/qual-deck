import { save, open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { select, execute } from '../../lib/db';

export const RECORDS_FORMAT = 'qualdeck-records';
// Backups written before the MathDeck → QualDeck rename.
const LEGACY_RECORDS_FORMATS = ['mathdeck-records'];
export const RECORDS_VERSION = 1;

export interface RecordsBundle {
  format: string;
  version: number;
  exported_at: string;
  libraries: { id: number; name: string }[];
  courses: { course_id: string; title: string; exam_length_minutes: number }[];
  attempts: any[];
  problem_state: any[];
  exam_sessions: any[];
  problem_lists: any[];
  problem_notes?: any[];
}

export interface ImportSummary {
  attempts_imported: number;
  attempts_skipped: number;
  states_imported: number;
  states_updated: number;
  sessions_imported: number;
  sessions_skipped: number;
  lists_created: number;
  list_items_imported: number;
  notes_imported: number;
  notes_updated: number;
  unknown_problems: number;
  unknown_libraries: string[];
  unknown_courses: string[];
}

function key(...parts: (string | number | null | undefined)[]) {
  return parts.map(p => (p == null ? '' : String(p))).join('\u0000');
}

export async function getDataFolder(): Promise<string> {
  return await appDataDir();
}

/**
 * Dump every user-generated record (attempts, per-problem state, virtual exam
 * sessions, custom lists) into a single portable JSON bundle. Source libraries
 * and imported problems are referenced by name/pid only — they are never part
 * of the payload, so importing can't clobber a library.
 */
export async function buildRecordsBundle(): Promise<RecordsBundle> {
  const [libraries, courses, attempts, problemState, sessions, intervals, results, lists, listItems, notes] =
    await Promise.all([
      select<any>('SELECT id, name FROM source_libraries ORDER BY id'),
      select<any>('SELECT course_id, title, exam_length_minutes FROM courses ORDER BY course_id'),
      select<any>(`
        SELECT a.*, sl.name AS library_name
        FROM attempts a
        LEFT JOIN problems p ON p.pid = a.pid AND p.course_id = a.course_id
        LEFT JOIN source_libraries sl ON p.source_library_id = sl.id
        ORDER BY a.created_at
      `),
      select<any>(`
        SELECT ps.*, sl.name AS library_name
        FROM problem_state ps
        LEFT JOIN problems p ON p.pid = ps.pid AND p.course_id = ps.course_id
        LEFT JOIN source_libraries sl ON p.source_library_id = sl.id
      `),
      select<any>(`
        SELECT es.*, sl.name AS library_name
        FROM exam_sessions es
        LEFT JOIN source_libraries sl ON es.source_library_id = sl.id
        WHERE es.source_library_id IS NULL OR sl.id IS NOT NULL
        ORDER BY es.started_at
      `),
      select<any>('SELECT * FROM exam_session_intervals ORDER BY session_id, started_at'),
      select<any>('SELECT * FROM exam_session_problem_results ORDER BY session_id, pid'),
      select<any>('SELECT * FROM problem_lists ORDER BY id'),
      select<any>('SELECT * FROM list_items'),
      select<any>(`
        SELECT n.pid, n.course_id, n.kind, n.note, n.updated_at, sl.name AS library_name
        FROM problem_notes n
        LEFT JOIN problems p ON p.pid = n.pid AND p.course_id = n.course_id
        LEFT JOIN source_libraries sl ON p.source_library_id = sl.id
        WHERE TRIM(n.note) <> ''
      `).catch(() => [] as any[]),
    ]);

  const intervalsBySession = new Map<number, any[]>();
  intervals.forEach(iv => {
    if (!intervalsBySession.has(iv.session_id)) intervalsBySession.set(iv.session_id, []);
    intervalsBySession.get(iv.session_id)!.push(iv);
  });
  const resultsBySession = new Map<number, any[]>();
  results.forEach(r => {
    if (!resultsBySession.has(r.session_id)) resultsBySession.set(r.session_id, []);
    resultsBySession.get(r.session_id)!.push(r);
  });
  const itemsByList = new Map<number, any[]>();
  listItems.forEach(it => {
    if (!itemsByList.has(it.list_id)) itemsByList.set(it.list_id, []);
    itemsByList.get(it.list_id)!.push(it);
  });

  return {
    format: RECORDS_FORMAT,
    version: RECORDS_VERSION,
    exported_at: new Date().toISOString(),
    libraries,
    courses,
    attempts: attempts.map(({ id, ...rest }) => rest),
    problem_state: problemState,
    exam_sessions: sessions.map(s => ({
      exam_id: s.exam_id,
      library_name: s.library_name,
      started_at: s.started_at,
      ended_at: s.ended_at,
      status: s.status,
      notes: s.notes,
      intervals: (intervalsBySession.get(s.id) ?? []).map(({ id, session_id, ...rest }) => rest),
      results: (resultsBySession.get(s.id) ?? []).map(({ id, session_id, ...rest }) => rest),
    })),
    problem_notes: notes,
    problem_lists: lists.map(l => ({
      name: l.name,
      description: l.description,
      created_at: l.created_at,
      items: (itemsByList.get(l.id) ?? []).map(it => ({
        pid: it.pid,
        course_id: it.course_id,
        added_at: it.added_at,
      })),
    })),
  };
}

/** Ask for a destination and write the bundle. Returns the path, or null if cancelled. */
export async function exportAllRecords(): Promise<string | null> {
  const bundle = await buildRecordsBundle();
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await save({
    title: 'Export all records',
    defaultPath: `qualdeck-records-${stamp}.json`,
    filters: [{ name: 'QualDeck records', extensions: ['json'] }],
  });
  if (!path) return null;
  await writeTextFile(path, JSON.stringify(bundle, null, 2));
  return path;
}

/**
 * Merge a bundle into the current database.
 *
 * Rules:
 *  - never touches source_libraries / problems / courses — records referring to
 *    a library, course or problem this install doesn't have are skipped;
 *  - every insert is de-duplicated, so re-importing the same file is a no-op.
 */
export async function importRecordsFromBundle(bundle: RecordsBundle): Promise<ImportSummary> {
  const summary: ImportSummary = {
    attempts_imported: 0,
    attempts_skipped: 0,
    states_imported: 0,
    states_updated: 0,
    sessions_imported: 0,
    sessions_skipped: 0,
    lists_created: 0,
    list_items_imported: 0,
    notes_imported: 0,
    notes_updated: 0,
    unknown_problems: 0,
    unknown_libraries: [],
    unknown_courses: [],
  };

  if (bundle.format !== RECORDS_FORMAT && !LEGACY_RECORDS_FORMATS.includes(bundle.format)) {
    throw new Error(`Not a QualDeck records file (format: ${bundle.format ?? 'unknown'})`);
  }

  const [localLibs, localCourses, localProblems, localAttempts, localStates, localSessions, localLists] =
    await Promise.all([
      select<any>('SELECT id, name FROM source_libraries'),
      select<any>('SELECT course_id FROM courses'),
      select<any>('SELECT pid, course_id FROM problems'),
      select<any>('SELECT pid, course_id, created_at, started_at FROM attempts'),
      select<any>('SELECT pid, course_id, last_attempt_at FROM problem_state'),
      select<any>('SELECT exam_id, started_at FROM exam_sessions'),
      select<any>('SELECT id, name FROM problem_lists'),
    ]);

  const libIdByName = new Map<string, number>(localLibs.map((l: any) => [l.name, l.id]));
  const courseSet = new Set<string>(localCourses.map((c: any) => c.course_id));
  const problemSet = new Set<string>(localProblems.map((p: any) => key(p.pid, p.course_id)));
  const attemptSet = new Set<string>(
    localAttempts.map((a: any) => key(a.pid, a.course_id, a.created_at, a.started_at))
  );
  const stateByKey = new Map<string, any>(localStates.map((s: any) => [key(s.pid, s.course_id), s]));
  const sessionSet = new Set<string>(
    localSessions.map((s: any) => key(s.exam_id, s.started_at))
  );
  const listIdByName = new Map<string, number>(localLists.map((l: any) => [l.name, l.id]));

  const missingLibs = new Set<string>();
  const missingCourses = new Set<string>();
  const affected: { pid: string; course_id: string }[] = [];

  const problemKnown = (pid: string, courseId: string, libraryName?: string | null) => {
    if (courseId && !courseSet.has(courseId)) { missingCourses.add(courseId); return false; }
    if (libraryName && !libIdByName.has(libraryName)) { missingLibs.add(libraryName); return false; }
    if (!problemSet.has(key(pid, courseId))) { summary.unknown_problems++; return false; }
    return true;
  };

  // ── Attempts ────────────────────────────────────────────────────────────────
  for (const a of bundle.attempts ?? []) {
    if (!problemKnown(a.pid, a.course_id, a.library_name)) continue;
    const k = key(a.pid, a.course_id, a.created_at, a.started_at);
    if (attemptSet.has(k)) { summary.attempts_skipped++; continue; }
    await execute(
      `INSERT INTO attempts
         (pid, course_id, started_at, ended_at, duration_seconds, attempt_mode,
          outcome, mastery, path_quality, used_solution, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.pid, a.course_id, a.started_at ?? null, a.ended_at ?? null, a.duration_seconds ?? 0,
       a.attempt_mode ?? null, a.outcome ?? null, a.mastery ?? null, a.path_quality ?? null,
       a.used_solution ?? 0, a.notes ?? null, a.created_at ?? null]
    );
    attemptSet.add(k);
    affected.push({ pid: a.pid, course_id: a.course_id });
    summary.attempts_imported++;
  }

  // ── Problem state ───────────────────────────────────────────────────────────
  for (const s of bundle.problem_state ?? []) {
    if (!problemKnown(s.pid, s.course_id, s.library_name)) continue;
    const k = key(s.pid, s.course_id);
    const local = stateByKey.get(k);
    if (!local) {
      await execute(
        `INSERT INTO problem_state
           (pid, course_id, current_mastery, stability, difficulty, last_attempt_at,
            next_review_at, total_attempts, total_duration_seconds, last_outcome,
            last_attempt_mode, manually_scheduled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.pid, s.course_id, s.current_mastery ?? 0, s.stability ?? 0, s.difficulty ?? 0,
         s.last_attempt_at ?? null, s.next_review_at ?? null, s.total_attempts ?? 0,
         s.total_duration_seconds ?? 0, s.last_outcome ?? null, s.last_attempt_mode ?? null,
         s.manually_scheduled ?? 0]
      );
      stateByKey.set(k, s);
      affected.push({ pid: s.pid, course_id: s.course_id });
      summary.states_imported++;
    } else if (s.last_attempt_at && (!local.last_attempt_at || s.last_attempt_at > local.last_attempt_at)) {
      // Imported row is more recent than the local one — take its scheduling data.
      await execute(
        `UPDATE problem_state
            SET current_mastery = ?, stability = ?, difficulty = ?, last_attempt_at = ?,
                next_review_at = ?, last_outcome = ?, last_attempt_mode = ?
          WHERE pid = ? AND course_id = ?`,
        [s.current_mastery ?? 0, s.stability ?? 0, s.difficulty ?? 0, s.last_attempt_at,
         s.next_review_at ?? null, s.last_outcome ?? null, s.last_attempt_mode ?? null,
         s.pid, s.course_id]
      );
      affected.push({ pid: s.pid, course_id: s.course_id });
      summary.states_updated++;
    }
  }

  // Attempt counters must reflect the merged attempts table, not either source alone.
  const affectedByKey = new Map(affected.map(a => [key(a.pid, a.course_id), a]));
  for (const { pid, course_id: courseId } of affectedByKey.values()) {
    await execute(
      `UPDATE problem_state
          SET total_attempts = (SELECT COUNT(*) FROM attempts a
                                 WHERE a.pid = problem_state.pid AND a.course_id = problem_state.course_id),
              total_duration_seconds = (SELECT COALESCE(SUM(a.duration_seconds), 0) FROM attempts a
                                 WHERE a.pid = problem_state.pid AND a.course_id = problem_state.course_id)
        WHERE pid = ? AND course_id = ?`,
      [pid, courseId]
    );
  }

  // ── Virtual exam sessions ───────────────────────────────────────────────────
  for (const s of bundle.exam_sessions ?? []) {
    const libId = s.library_name ? libIdByName.get(s.library_name) : null;
    if (s.library_name && libId === undefined) { missingLibs.add(s.library_name); continue; }
    const k = key(s.exam_id, s.started_at);
    if (sessionSet.has(k)) { summary.sessions_skipped++; continue; }
    const res = await execute(
      `INSERT INTO exam_sessions (exam_id, source_library_id, started_at, ended_at, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [s.exam_id, libId ?? null, s.started_at, s.ended_at ?? null, s.status ?? 'completed', s.notes ?? null]
    );
    const sessionId = res.lastInsertId;
    if (sessionId == null) continue;
    sessionSet.add(k);
    summary.sessions_imported++;

    for (const iv of s.intervals ?? []) {
      if (!problemSet.has(key(iv.pid, iv.course_id))) continue;
      await execute(
        `INSERT INTO exam_session_intervals (session_id, pid, course_id, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, iv.pid, iv.course_id, iv.started_at, iv.ended_at ?? null]
      );
    }
    for (const r of s.results ?? []) {
      if (!problemSet.has(key(r.pid, r.course_id))) continue;
      await execute(
        `INSERT OR IGNORE INTO exam_session_problem_results (session_id, pid, course_id, mastery, outcome, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, r.pid, r.course_id, r.mastery ?? null, r.outcome ?? null, r.notes ?? null]
      );
    }
  }

  // ── Problem lists ───────────────────────────────────────────────────────────
  for (const l of bundle.problem_lists ?? []) {
    let listId = listIdByName.get(l.name);
    if (listId === undefined) {
      const res = await execute(
        'INSERT INTO problem_lists (name, description, created_at) VALUES (?, ?, COALESCE(?, datetime(\'now\')))',
        [l.name, l.description ?? null, l.created_at ?? null]
      );
      if (res.lastInsertId == null) continue;
      listId = res.lastInsertId;
      listIdByName.set(l.name, listId);
      summary.lists_created++;
    }
    for (const it of l.items ?? []) {
      if (!problemSet.has(key(it.pid, it.course_id))) { summary.unknown_problems++; continue; }
      const res = await execute(
        'INSERT OR IGNORE INTO list_items (list_id, pid, course_id, added_at) VALUES (?, ?, ?, COALESCE(?, datetime(\'now\')))',
        [listId, it.pid, it.course_id, it.added_at ?? null]
      );
      if (res.rowsAffected > 0) summary.list_items_imported++;
    }
  }

  // ── Problem / solution notes ────────────────────────────────────────────────
  if (bundle.problem_notes && bundle.problem_notes.length > 0) {
    const localNotes = await select<any>(
      'SELECT pid, course_id, kind, note, updated_at FROM problem_notes'
    ).catch(() => [] as any[]);
    const noteByKey = new Map<string, any>(
      localNotes.map((n: any) => [key(n.pid, n.course_id, n.kind), n])
    );
    for (const n of bundle.problem_notes) {
      if (!n.note || !String(n.note).trim()) continue;
      if (!problemKnown(n.pid, n.course_id, n.library_name)) continue;
      const k = key(n.pid, n.course_id, n.kind);
      const local = noteByKey.get(k);
      if (!local) {
        await execute(
          `INSERT INTO problem_notes (pid, course_id, kind, note, updated_at)
           VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
          [n.pid, n.course_id, n.kind, n.note, n.updated_at ?? null]
        );
        noteByKey.set(k, n);
        summary.notes_imported++;
      } else if (
        String(local.note ?? '').trim() !== String(n.note).trim() &&
        (!String(local.note ?? '').trim() ||
          (n.updated_at && (!local.updated_at || n.updated_at > local.updated_at)))
      ) {
        // Local note is empty, or the imported one is newer — take the imported text.
        await execute(
          `UPDATE problem_notes SET note = ?, updated_at = COALESCE(?, datetime('now'))
            WHERE pid = ? AND course_id = ? AND kind = ?`,
          [n.note, n.updated_at ?? null, n.pid, n.course_id, n.kind]
        );
        summary.notes_updated++;
      }
    }
  }

  summary.unknown_libraries = Array.from(missingLibs);
  summary.unknown_courses = Array.from(missingCourses);
  return summary;
}

/** Ask for a records file and merge it. Returns null if the dialog was cancelled. */
export async function importAllRecords(): Promise<ImportSummary | null> {
  const selected = await open({
    title: 'Import records from…',
    multiple: false,
    directory: false,
    filters: [{ name: 'QualDeck records', extensions: ['json'] }],
  });
  if (!selected || typeof selected !== 'string') return null;
  const raw = await readTextFile(selected);
  const bundle = JSON.parse(raw) as RecordsBundle;
  return await importRecordsFromBundle(bundle);
}
