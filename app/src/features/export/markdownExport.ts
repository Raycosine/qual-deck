import { writeTextFile, readDir, copyFile, remove, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { select } from '../../lib/db';

const DEFAULT_EXPORT_SUBDIR = 'export_data';

interface AttemptRecord {
  pid: string;
  course_id: string;
  mastery: number;
  outcome: string;
  duration_seconds: number;
  attempt_mode: string;
  created_at: string;
}

interface SessionRecord {
  id: number;
  exam_id: string;
  library_name: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  notes: string | null;
}

interface SessionResult {
  pid: string;
  course_id: string;
  mastery: number | null;
  outcome: string | null;
}

function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s > 0 ? ` ${s}s` : ''}` : `${s}s`;
}

function pjoin(base: string, ...rest: string[]): string {
  const normalized = base.replace(/[\\/]+$/, '');
  return [normalized, ...rest].join('/');
}

export async function getExportFolder(): Promise<string> {
  const rows = await select<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'export_folder'`
  );
  if (rows[0]?.value) return rows[0].value;
  const base = await appDataDir();
  return pjoin(base, DEFAULT_EXPORT_SUBDIR);
}

export async function exportDailyMarkdown(date?: string): Promise<void> {
  const today = date ?? new Date().toISOString().split('T')[0];
  const folder = await getExportFolder();
  await mkdir(folder, { recursive: true }).catch(() => {});

  const [attempts, sessions] = await Promise.all([
    select<AttemptRecord>(`
      SELECT pid, course_id, mastery, outcome, duration_seconds, attempt_mode, created_at
      FROM attempts
      WHERE date(created_at) = ?
      ORDER BY created_at ASC
    `, [today]),
    select<SessionRecord>(`
      SELECT es.id, es.exam_id, sl.name AS library_name,
             es.started_at, es.ended_at, es.status, es.notes
      FROM exam_sessions es
      LEFT JOIN source_libraries sl ON es.source_library_id = sl.id
      WHERE date(es.started_at) = ?
      ORDER BY es.started_at ASC
    `, [today]),
  ]);

  let md = `# QualDeck Daily Record — ${today}\n\n`;

  md += `## Problem Attempts\n\n`;
  if (attempts.length === 0) {
    md += `_No problem attempts today._\n\n`;
  } else {
    md += `| Time | Problem | Course | Mastery | Outcome | Duration | Mode |\n`;
    md += `|------|---------|--------|---------|---------|----------|------|\n`;
    for (const a of attempts) {
      const t = new Date(a.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      md += `| ${t} | ${a.pid} | ${a.course_id} | ${a.mastery} | ${a.outcome} | ${fmtDur(a.duration_seconds)} | ${a.attempt_mode} |\n`;
    }
    const total = attempts.reduce((s, a) => s + a.duration_seconds, 0);
    const avgM = (attempts.reduce((s, a) => s + a.mastery, 0) / attempts.length).toFixed(1);
    md += `\n**${attempts.length} attempt${attempts.length !== 1 ? 's' : ''}** · Total: ${fmtDur(total)} · Avg mastery: ${avgM}\n\n`;
  }

  md += `## Virtual Exam Sessions\n\n`;
  if (sessions.length === 0) {
    md += `_No virtual exam sessions today._\n\n`;
  } else {
    for (const s of sessions) {
      const results = await select<SessionResult>(
        `SELECT pid, course_id, mastery, outcome FROM exam_session_problem_results WHERE session_id = ? ORDER BY pid`,
        [s.id]
      );
      const durMin = s.ended_at
        ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)
        : null;
      const startTime = new Date(s.started_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      md += `### ${s.exam_id.toUpperCase()} — ${s.library_name ?? 'Unknown Library'}\n\n`;
      md += `**Started:** ${startTime}${durMin !== null ? ` · **Duration:** ${durMin}m` : ''} · **Status:** ${s.status}\n\n`;
      if (results.length > 0) {
        md += `| Problem | Course | Mastery | Outcome |\n|---------|--------|---------|--------|\n`;
        for (const r of results) {
          md += `| ${r.pid} | ${r.course_id} | ${r.mastery ?? '—'} | ${r.outcome ?? '—'} |\n`;
        }
        md += '\n';
      }
      if (s.notes) md += `**Notes:** ${s.notes}\n\n`;
    }
  }

  const filePath = pjoin(folder, `${today}.md`);
  await writeTextFile(filePath, md);
}

export async function moveExportFiles(fromFolder: string, toFolder: string): Promise<void> {
  await mkdir(toFolder, { recursive: true }).catch(() => {});
  try {
    const entries = await readDir(fromFolder);
    for (const entry of entries) {
      if (entry.name?.endsWith('.md') && entry.isFile) {
        const src = pjoin(fromFolder, entry.name);
        const dst = pjoin(toFolder, entry.name);
        await copyFile(src, dst);
        await remove(src);
      }
    }
  } catch {
    // Old folder may not exist yet — no-op
  }
}
