import React, { useEffect, useRef, useState } from 'react';
import { select, execute } from '../lib/db';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, PlayCircle, History, X, ChevronRight, Clock, Pencil, Check, FileText,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExamRow {
  exam_id: string;
  year: number;
  semester: string;
  source_library_id: number;
  library_name: string;
  exam_length_minutes: number;
  problem_count: number;
  attempted_count: number;
  avg_mastery: number;
  session_count: number;
  question_pdf_path: string | null;
}

interface ExamSession {
  id: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  notes: string | null;
  problem_count: number;
  graded_count: number;
}

interface SessionInterval {
  pid: string;
  course_id: string;
  started_at: string;
  ended_at: string | null;
}

interface ProblemResult {
  pid: string;
  course_id: string;
  mastery: number | null;
  outcome: string | null;
  notes: string | null;
}

// Lazy ECharts chart wrapper
const GanttChart: React.FC<{
  intervals: SessionInterval[];
  problems: { pid: string; course_id: string }[];
  sessionStart: string;
  examMinutes: number;
}> = ({ intervals, problems, sessionStart, examMinutes }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || intervals.length === 0) return;
    import('echarts').then(echarts => {
      if (!inst.current) inst.current = echarts.init(ref.current!);

      const pids = problems.map(p => p.pid);
      const sessionMs = new Date(sessionStart).getTime();

      const ganttData = intervals
        .filter(iv => iv.ended_at)
        .map(iv => {
          const pidIdx = pids.indexOf(iv.pid);
          const s = (new Date(iv.started_at).getTime() - sessionMs) / 60000;
          const e = (new Date(iv.ended_at!).getTime() - sessionMs) / 60000;
          return [pidIdx, s, e, iv.pid];
        });

      inst.current.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          formatter: (p: any) => {
            const [, s, e, pid] = p.value;
            return `${pid}: ${s.toFixed(1)}m → ${e.toFixed(1)}m (${(e - s).toFixed(1)}m)`;
          },
        },
        xAxis: {
          min: 0, max: Math.max(examMinutes, ...ganttData.map(d => d[2] as number)),
          name: 'Minutes', nameLocation: 'end', nameGap: 8,
          axisLabel: { formatter: (v: number) => `${v}m` },
        },
        yAxis: { type: 'category', data: pids },
        series: [{
          type: 'custom',
          renderItem: (_p: any, api: any) => {
            const catIdx = api.value(0);
            const start = api.coord([api.value(1), catIdx]);
            const end = api.coord([api.value(2), catIdx]);
            const h = api.size([0, 1])[1] * 0.55;
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - h / 2, width: Math.max(end[0] - start[0], 2), height: h },
              style: { fill: '#6366f1' },
            };
          },
          encode: { x: [1, 2], y: 0 },
          data: ganttData,
        }],
        grid: { left: 60, right: 20, top: 20, bottom: 30 },
      });
    });
    return () => { inst.current?.dispose(); inst.current = null; };
  }, [intervals, problems, sessionStart, examMinutes]);

  if (intervals.length === 0) return <p className="text-xs text-muted-foreground italic">No intervals recorded.</p>;
  return <div ref={ref} style={{ width: '100%', height: Math.max(180, problems.length * 36 + 60) }} />;
};

const formatDur = (s: number) => {
  const m = Math.floor(s / 60); const sec = s % 60;
  return m > 0 ? `${m}m ${sec > 0 ? sec + 's' : ''}`.trim() : `${sec}s`;
};

const ExamsPage: React.FC = () => {
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeLibId, setActiveLibId] = useState<number | null>(null);

  // History modal state
  const [historyExam, setHistoryExam] = useState<ExamRow | null>(null);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [sessionIntervals, setSessionIntervals] = useState<SessionInterval[]>([]);
  const [sessionResults, setSessionResults] = useState<ProblemResult[]>([]);
  const [sessionProblems, setSessionProblems] = useState<{ pid: string; course_id: string }[]>([]);
  const [editingNotesFor, setEditingNotesFor] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');

  useEffect(() => {
    select<ExamRow>(`
      SELECT
        p.exam_id,
        COALESCE(e.year, 0) AS year,
        COALESCE(e.semester, '') AS semester,
        p.source_library_id,
        sl.name AS library_name,
        COALESCE(
          (SELECT c.exam_length_minutes FROM courses c
           WHERE c.course_id = (
             SELECT p3.course_id FROM problems p3
             WHERE p3.exam_id = p.exam_id AND p3.source_library_id = p.source_library_id LIMIT 1
           )),
          120
        ) AS exam_length_minutes,
        COUNT(p.pid) AS problem_count,
        COUNT(ps.last_attempt_at) AS attempted_count,
        COALESCE(CAST(SUM(COALESCE(ps.current_mastery,0)) AS REAL) / NULLIF(COUNT(p.pid),0), 0) AS avg_mastery,
        (SELECT COUNT(*) FROM exam_sessions es
         WHERE es.exam_id = p.exam_id AND es.source_library_id = p.source_library_id
           AND es.status = 'completed') AS session_count,
        (SELECT pf.absolute_path FROM pdf_files pf
         WHERE pf.exam_id = p.exam_id AND pf.kind = 'question'
           AND pf.source_library_id = p.source_library_id
         ORDER BY pf.is_primary DESC, pf.id ASC LIMIT 1) AS question_pdf_path
      FROM problems p
      JOIN source_libraries sl ON p.source_library_id = sl.id
      LEFT JOIN exams e ON e.exam_id = p.exam_id
      LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
      GROUP BY p.exam_id, p.source_library_id
      ORDER BY sl.name ASC, e.year DESC, e.semester DESC
    `).then(setExams).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Group by library
  const grouped = exams.reduce<Record<number, ExamRow[]>>((acc, row) => {
    (acc[row.source_library_id] ??= []).push(row);
    return acc;
  }, {});

  useEffect(() => {
    if (activeLibId === null && exams.length > 0) {
      setActiveLibId(exams[0].source_library_id);
    }
  }, [exams]);

  const openHistory = async (exam: ExamRow) => {
    setHistoryExam(exam);
    setExpandedSession(null);
    const data = await select<ExamSession>(`
      SELECT es.id, es.started_at, es.ended_at, es.status, es.notes,
        (SELECT COUNT(DISTINCT esi.pid) FROM exam_session_intervals esi WHERE esi.session_id = es.id) AS problem_count,
        (SELECT COUNT(*) FROM exam_session_problem_results r WHERE r.session_id = es.id) AS graded_count
      FROM exam_sessions es
      WHERE es.exam_id = ? AND es.source_library_id = ?
      ORDER BY es.started_at DESC
    `, [exam.exam_id, exam.source_library_id]);
    setSessions(data);
  };

  const openSession = async (session: ExamSession) => {
    if (expandedSession === session.id) { setExpandedSession(null); return; }
    setExpandedSession(session.id);
    const [intervals, results, probs] = await Promise.all([
      select<SessionInterval>(`
        SELECT pid, course_id, started_at, ended_at
        FROM exam_session_intervals WHERE session_id = ? ORDER BY started_at
      `, [session.id]),
      select<ProblemResult>(`
        SELECT pid, course_id, mastery, outcome, notes
        FROM exam_session_problem_results WHERE session_id = ?
      `, [session.id]),
      select<{ pid: string; course_id: string }>(`
        SELECT DISTINCT pid, course_id FROM exam_session_intervals
        WHERE session_id = ? ORDER BY pid
      `, [session.id]),
    ]);
    setSessionIntervals(intervals);
    setSessionResults(results);
    setSessionProblems(probs);
  };

  const saveSessionNotes = async (sessionId: number) => {
    const value = notesDraft.trim();
    await execute('UPDATE exam_sessions SET notes = ? WHERE id = ?', [value || null, sessionId]);
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, notes: value || null } : s)));
    setEditingNotesFor(null);
  };

  // Per-problem total seconds for a session
  const computeTotals = (intervals: SessionInterval[]) => {
    const totals: Record<string, number> = {};
    for (const iv of intervals) {
      if (!iv.ended_at) continue;
      const secs = (new Date(iv.ended_at).getTime() - new Date(iv.started_at).getTime()) / 1000;
      totals[iv.pid] = (totals[iv.pid] ?? 0) + secs;
    }
    return totals;
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Exams</h1>
        <p className="text-muted-foreground mt-1">Browse exams by library and start a virtual participation session.</p>
      </header>

      {Object.keys(grouped).length === 0 && (
        <p className="text-muted-foreground">No exams imported yet.</p>
      )}

      {Object.keys(grouped).length > 0 && (
        <>
          {/* Library tabs */}
          <div className="flex gap-2 flex-wrap border-b pb-4">
            {Object.entries(grouped).map(([libId, rows]) => (
              <button
                key={libId}
                onClick={() => setActiveLibId(Number(libId))}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors',
                  activeLibId === Number(libId)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <span>{rows[0].library_name}</span>
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full font-normal',
                  activeLibId === Number(libId) ? 'bg-white/20' : 'bg-background/60'
                )}>
                  {rows.length} exam{rows.length !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>

          {activeLibId !== null && grouped[activeLibId] && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {grouped[activeLibId].map(exam => (
              <div key={`${exam.exam_id}-${exam.source_library_id}`}
                className="bg-card border rounded-lg p-5 space-y-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold uppercase">{exam.exam_id}</h3>
                    <p className="text-xs text-muted-foreground">
                      {exam.year} · {exam.semester?.toUpperCase()}
                    </p>
                  </div>
                  <span className="text-[11px] bg-accent px-2 py-0.5 rounded font-semibold">
                    {exam.problem_count} probs
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Attempted</span>
                    <span className="font-medium text-foreground">{exam.attempted_count}/{exam.problem_count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all"
                      style={{ width: `${exam.problem_count > 0 ? (exam.attempted_count / exam.problem_count) * 100 : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Avg Mastery</span>
                    <span className="font-medium text-foreground">{exam.avg_mastery.toFixed(1)}/4.0</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t">
                  <button
                    onClick={() => navigate(`/problems?exam=${exam.exam_id}&library=${exam.source_library_id}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
                  >
                    <BookOpen className="w-3.5 h-3.5" /> Browse
                  </button>
                  <button
                    onClick={() => navigate(`/exam-virtual?examId=${exam.exam_id}&libraryId=${exam.source_library_id}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-bold hover:opacity-90 transition-opacity"
                  >
                    <PlayCircle className="w-3.5 h-3.5" /> Participate
                  </button>
                  <button
                    onClick={() => exam.question_pdf_path && navigate(
                      `/pdf-viewer?path=${encodeURIComponent(exam.question_pdf_path)}` +
                      `&examId=${exam.exam_id}&libraryId=${exam.source_library_id}` +
                      `&from=${encodeURIComponent('/exams')}`
                    )}
                    disabled={!exam.question_pdf_path}
                    className={cn(
                      'p-1.5 border rounded-md transition-colors',
                      exam.question_pdf_path ? 'hover:bg-accent' : 'opacity-30 cursor-not-allowed'
                    )}
                    title="Open exam PDF with notes"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openHistory(exam)}
                    className={cn(
                      'p-1.5 border rounded-md hover:bg-accent transition-colors relative',
                      exam.session_count > 0 && 'text-primary border-primary/30'
                    )}
                    title="Session history"
                  >
                    <History className="w-3.5 h-3.5" />
                    {exam.session_count > 0 && (
                      <span className="absolute -top-1 -right-1 text-[9px] bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                        {exam.session_count}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* History modal */}
      {historyExam && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background border rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
            <header className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="font-bold text-lg">{historyExam.exam_id.toUpperCase()} Sessions</h2>
                <p className="text-xs text-muted-foreground">{historyExam.library_name}</p>
              </div>
              <button onClick={() => setHistoryExam(null)} className="p-1.5 hover:bg-accent rounded-md">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {sessions.length === 0 && (
                <p className="text-sm text-muted-foreground italic text-center py-8">No sessions yet.</p>
              )}
              {sessions.map(session => {
                const totals = expandedSession === session.id ? computeTotals(sessionIntervals) : {};
                const durSecs = session.ended_at
                  ? (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000
                  : null;

                return (
                  <div key={session.id} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => openSession(session)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 text-left transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-bold uppercase',
                          session.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                        )}>
                          {session.status}
                        </span>
                        <span className="text-sm font-medium">{new Date(session.started_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {durSecs !== null && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDur(durSecs)}</span>
                        )}
                        <span>{session.graded_count}/{session.problem_count} graded</span>
                        <ChevronRight className={cn('w-4 h-4 transition-transform', expandedSession === session.id && 'rotate-90')} />
                      </div>
                    </button>

                    {expandedSession === session.id && (
                      <div className="border-t px-4 py-4 space-y-4 bg-muted/20">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Timeline</p>
                          <GanttChart
                            intervals={sessionIntervals}
                            problems={sessionProblems}
                            sessionStart={session.started_at}
                            examMinutes={historyExam.exam_length_minutes}
                          />
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Per-Problem Time</p>
                          <div className="space-y-1.5">
                            {sessionProblems.map(p => {
                              const secs = totals[p.pid] ?? 0;
                              const maxSecs = Math.max(...Object.values(totals), 1);
                              const result = sessionResults.find(r => r.pid === p.pid);
                              return (
                                <div key={p.pid} className="flex items-center gap-3 text-xs">
                                  <span className="w-20 font-mono truncate">{p.pid}</span>
                                  <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                                    <div className="h-full bg-primary/60 rounded"
                                      style={{ width: `${(secs / maxSecs) * 100}%` }} />
                                  </div>
                                  <span className="w-12 text-right text-muted-foreground">{formatDur(secs)}</span>
                                  {result?.mastery != null && (
                                    <span className="w-6 text-center font-bold text-primary">{result.mastery}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exam Notes</p>
                            {editingNotesFor !== session.id && (
                              <button
                                onClick={() => { setEditingNotesFor(session.id); setNotesDraft(session.notes ?? ''); }}
                                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                title={session.notes ? 'Edit notes' : 'Add notes'}
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {editingNotesFor === session.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={notesDraft}
                                onChange={e => setNotesDraft(e.target.value)}
                                autoFocus
                                rows={4}
                                className="w-full px-2 py-1.5 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveSessionNotes(session.id)}
                                  className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90"
                                >
                                  <Check className="w-3 h-3" /> Save
                                </button>
                                <button
                                  onClick={() => setEditingNotesFor(null)}
                                  className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium hover:bg-accent"
                                >
                                  <X className="w-3 h-3" /> Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className={cn(
                              'text-sm whitespace-pre-wrap',
                              session.notes ? 'text-muted-foreground' : 'text-muted-foreground/60 italic'
                            )}>
                              {session.notes || 'No notes for this session.'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamsPage;
