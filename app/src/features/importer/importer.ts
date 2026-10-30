import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { execute, select } from '../../lib/db';

export interface ImportSummary {
  jsonFilesFound: number;
  jsonFilesImported: number;
  jsonFilesSkipped: number;
  examsImported: number;
  problemsImported: number;
  pdfsFound: number;
  solutionsFound: number;
  solutionsMatched: number;
  unmatchedPdfs: number;
  topicsImported: number;
}

export async function runImport(rootPath: string, libraryId: number): Promise<ImportSummary> {
  const summary: ImportSummary = {
    jsonFilesFound: 0,
    jsonFilesImported: 0,
    jsonFilesSkipped: 0,
    examsImported: 0,
    problemsImported: 0,
    pdfsFound: 0,
    solutionsFound: 0,
    solutionsMatched: 0,
    unmatchedPdfs: 0,
    topicsImported: 0,
  };

  const jsonDir = await join(rootPath, 'json');
  const examsDir = await join(rootPath, 'exams');
  const pdfsDir = await join(rootPath, 'pdfs');
  const solutionsDir = await join(rootPath, 'solutions');

  // 1. Scan JSON files — throw if the directory is inaccessible
  const jsonEntries = await readDir(jsonDir);
  const jsonFiles = jsonEntries.filter(e => e.name?.endsWith('.json'));
  summary.jsonFilesFound = jsonFiles.length;

  for (const entry of jsonFiles) {
    try {
      const filePath = await join(jsonDir, entry.name!);
      const content = await readTextFile(filePath);
      const data = JSON.parse(content);
      const { exams, problems } = await importExamData(data, libraryId);
      summary.examsImported += exams;
      summary.problemsImported += problems;
      summary.jsonFilesImported++;
    } catch (err) {
      console.error(`Skipping ${entry.name}:`, err);
      summary.jsonFilesSkipped++;
    }
  }

  // 2. Scan PDF files — clear existing records then re-insert from all known subdirectories
  await execute(`DELETE FROM pdf_files WHERE source_library_id = ?`, [libraryId]);

  // Helper to insert one PDF entry and update summary counters
  const insertPdf = async (dir: string, filename: string, forcedKind?: 'solution' | 'question') => {
    try {
      const filePath = await join(dir, filename);
      const kind = forcedKind ?? (isSolution(filename) ? 'solution' : 'question');
      if (kind === 'solution') summary.solutionsFound++;
      summary.pdfsFound++;

      const examId = inferExamId(filename);
      if (!examId) {
        summary.unmatchedPdfs++;
      } else if (kind === 'solution') {
        summary.solutionsMatched++;
      }

      await execute(
        `INSERT INTO pdf_files (source_library_id, exam_id, source_filename, absolute_path, kind)
         VALUES (?, ?, ?, ?, ?)`,
        [libraryId, examId ?? null, filename, filePath, kind]
      );
    } catch (err) {
      console.error(`Skipping PDF ${filename}:`, err);
    }
  };

  // exams/ — every PDF here is a question/exam PDF by definition
  try {
    const entries = await readDir(examsDir);
    for (const e of entries.filter(e => e.name?.endsWith('.pdf'))) {
      await insertPdf(examsDir, e.name!, 'question');
    }
  } catch {
    // directory absent — skip silently
  }

  // pdfs/ — mixed question/solution PDFs detected by filename
  try {
    const entries = await readDir(pdfsDir);
    for (const e of entries.filter(e => e.name?.endsWith('.pdf'))) {
      await insertPdf(pdfsDir, e.name!);
    }
  } catch {
    // directory absent — skip silently
  }

  // solutions/ — every PDF here is a solution by definition
  try {
    const entries = await readDir(solutionsDir);
    for (const e of entries.filter(e => e.name?.endsWith('.pdf'))) {
      await insertPdf(solutionsDir, e.name!, 'solution');
    }
  } catch {
    // directory absent — skip silently
  }

  // 3. Import taxonomy hierarchy
  summary.topicsImported = await importTaxonomies(rootPath);

  return summary;
}

function isSolution(filename: string): boolean {
  const lower = filename.toLowerCase();
  const markers = ['-sol', '_sol', ' solution', '-solution', '_solution', 'solutions', 'answer', 'answers'];
  return markers.some(m => lower.includes(m));
}

function inferExamId(filename: string): string | null {
  const lower = filename.toLowerCase().replace(/\.pdf$/, '');

  // Pattern 1: fa/sp prefix + 2-4 digit year  e.g. fa00, sp23, 540-Fa17-sol, sp99
  const shortMatch = lower.match(/\b(fa|sp)(\d{2,4})\b/);
  if (shortMatch) {
    const year = shortMatch[2].length > 2 ? shortMatch[2].slice(-2) : shortMatch[2];
    return shortMatch[1] + year;
  }

  // Pattern 2: "Spring YYYY" / "Fall YYYY"  e.g. "Spring 2025 Solutions..."
  const longMatch = lower.match(/\b(spring|fall)\s+(\d{4})\b/);
  if (longMatch) {
    const prefix = longMatch[1] === 'spring' ? 'sp' : 'fa';
    return prefix + longMatch[2].slice(-2);
  }

  return null;
}

async function importExamData(
  data: any,
  libraryId: number
): Promise<{ exams: number; problems: number }> {
  const { exam_id, year, semester, source_filename, metadata_needs_review, problems } = data;

  if (!exam_id) throw new Error('Missing exam_id');
  if (!Array.isArray(problems)) throw new Error('Missing problems array');

  await execute(
    `INSERT OR REPLACE INTO exams (exam_id, source_library_id, year, semester, source_filename, metadata_needs_review)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [exam_id, libraryId, year ?? null, semester ?? null, source_filename ?? null, metadata_needs_review ? 1 : 0]
  );

  let importedProblems = 0;
  for (const p of problems) {
    if (!p.pid || !p.course) continue;

    await execute(
      `INSERT OR IGNORE INTO courses (course_id, title) VALUES (?, ?)`,
      [p.course, `Course ${p.course}`]
    );

    await execute(
      `INSERT OR REPLACE INTO problems (
        pid, exam_id, course_id, problem_number, secondary_course_id,
        course_confidence, topic_confidence, problem_statement,
        evidence, needs_review, review_reason, additional_topic_suggestion,
        source_library_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.pid, exam_id, p.course, p.problem_number ?? null,
        p.secondary_course ?? null, p.course_confidence ?? null,
        p.topic_confidence ?? null, p.problem_statement ?? null,
        p.evidence ?? null, p.needs_review ? 1 : 0,
        p.review_reason ?? null, p.additional_topic_suggestion ?? null,
        libraryId,
      ]
    );

    if (Array.isArray(p.topics)) {
      for (const topicName of p.topics) {
        await execute(
          `INSERT OR IGNORE INTO problem_topics (pid, course_id, topic_name, topic_kind)
           VALUES (?, ?, ?, ?)`,
          [p.pid, p.course, topicName, 'confirmed']
        );
      }
    }

    if (Array.isArray(p.possible_topics)) {
      for (const topicName of p.possible_topics) {
        await execute(
          `INSERT OR IGNORE INTO problem_topics (pid, course_id, topic_name, topic_kind)
           VALUES (?, ?, ?, ?)`,
          [p.pid, p.course, topicName, 'possible']
        );
      }
    }

    importedProblems++;
  }

  return { exams: 1, problems: importedProblems };
}

// Parses a taxonomy markdown file: ## headings become level-1, - bullets become level-2.
function parseTaxonomy(content: string): Array<{ name: string; level: 1 | 2; parent: string | null }> {
  const topics: Array<{ name: string; level: 1 | 2; parent: string | null }> = [];
  let currentParent: string | null = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      currentParent = h2[1].trim();
      topics.push({ name: currentParent, level: 1, parent: null });
      continue;
    }
    const bullet = trimmed.match(/^-\s+(.+)$/);
    if (bullet && currentParent) {
      topics.push({ name: bullet[1].trim(), level: 2, parent: currentParent });
    }
  }
  return topics;
}

async function importTaxonomies(rootPath: string): Promise<number> {
  const taxonomiesDir = await join(rootPath, 'taxonomies');
  let count = 0;
  try {
    const entries = await readDir(taxonomiesDir);
    const mdFiles = entries.filter(e => e.name?.match(/^\w+_topics\.md$/));
    for (const entry of mdFiles) {
      try {
        const courseMatch = entry.name!.match(/^(\w+)_topics\.md$/);
        if (!courseMatch) continue;
        const courseId = courseMatch[1];

        const filePath = await join(taxonomiesDir, entry.name!);
        const content = await readTextFile(filePath);
        const topics = parseTaxonomy(content);
        if (topics.length === 0) continue;

        // Clear and re-insert all topic_nodes for this course
        await execute(`DELETE FROM topic_nodes WHERE course_id = ?`, [courseId]);

        // Insert level-1 topics
        let sortOrder = 0;
        for (const t of topics.filter(t => t.level === 1)) {
          await execute(
            `INSERT INTO topic_nodes (course_id, name, level, parent_id, sort_order) VALUES (?, ?, 1, NULL, ?)`,
            [courseId, t.name, sortOrder++]
          );
        }

        // Build name→id map for all level-1 nodes just inserted
        const parentRows = await select<{ id: number; name: string }>(
          `SELECT id, name FROM topic_nodes WHERE course_id = ? AND level = 1`,
          [courseId]
        );
        const parentIdMap: Record<string, number> = {};
        for (const row of parentRows) parentIdMap[row.name] = row.id;

        // Insert level-2 topics
        sortOrder = 0;
        for (const t of topics.filter(t => t.level === 2)) {
          const parentId = t.parent ? (parentIdMap[t.parent] ?? null) : null;
          await execute(
            `INSERT INTO topic_nodes (course_id, name, level, parent_id, sort_order) VALUES (?, ?, 2, ?, ?)`,
            [courseId, t.name, parentId, sortOrder++]
          );
        }

        count += topics.length;

        // Link problem_topics rows to their topic_node by matching name and course
        await execute(`
          UPDATE problem_topics
          SET topic_node_id = (
            SELECT tn.id FROM topic_nodes tn
            WHERE tn.name = problem_topics.topic_name
              AND tn.course_id = problem_topics.course_id
            LIMIT 1
          )
          WHERE course_id = ?
        `, [courseId]);

      } catch (err) {
        console.error(`Skipping taxonomy ${entry.name}:`, err);
      }
    }
  } catch {
    // taxonomies directory absent — skip silently
  }
  return count;
}
