import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { select, execute } from '../lib/db';
import { scheduleFSRS } from '../features/reviews/scheduler';
import { exportDailyMarkdown } from '../features/export/markdownExport';
import {
  Play, Square, CheckCircle2, Clock, ChevronDown, X, Save,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExamProblem {
  pid: string;
  course_id: string;
  problem_number: number | null;
}

interface ProblemGrade {
  mastery: number;
  outcome: string;
  notes: string;
}

const OUTCOME_OPTIONS = [
  { value: 'correct', label: 'Correct' },
  { value: 'mostly_correct', label: 'Mostly Correct' },
  { value: 'partial', label: 'Partial' },
  { value: 'wrong', label: 'Wrong' },
  { value: 'gave_up', label: 'Gave Up' },
];

const formatTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const ExamVirtualPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const examId = searchParams.get('examId') ?? '';
  const libraryId = parseInt(searchParams.get('libraryId') ?? '0');

  const [problems, setProblems] = useState<ExamProblem[]>([]);
  const [questionPdfUrl, setQuestionPdfUrl] = useState<string | null>(null);
  const [examLengthMinutes, setExamLengthMinutes] = useState(120);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'active' | 'grading' | 'saving'>('idle');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [_sessionStartMs, setSessionStartMs] = useState<number>(0);

  // Active interval tracking (in-memory, written to DB on each switch)
  const [activePid, setActivePid] = useState<string | null>(null);
  const [activeIntervalId, setActiveIntervalId] = useState<number | null>(null);
  // Seconds accumulated in DB (excluding current active interval)
  const [storedSeconds, setStoredSeconds] = useState<Record<string, number>>({});

  // Elapsed timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grading state
  const [grades, setGrades] = useState<Record<string, ProblemGrade>>({});
  const [examNotes, setExamNotes] = useState('');
  const [gradingExpanded, setGradingExpanded] = useState<string | null>(null);

  // Load exam data
  useEffect(() => {
    if (!examId || !libraryId) return;
    const load = async () => {
      const [probs, pdfs, courseData] = await Promise.all([
        select<ExamProblem>(`
          SELECT pid, course_id, problem_number
          FROM problems
          WHERE exam_id = ? AND source_library_id = ?
          ORDER BY problem_number ASC, pid ASC
        `, [examId, libraryId]),
        select<{ absolute_path: string }>(`
          SELECT absolute_path FROM pdf_files
          WHERE exam_id = ? AND source_library_id = ? AND kind = 'question'
          ORDER BY is_primary DESC, id ASC LIMIT 1
        `, [examId, libraryId]),
        select<{ exam_length_minutes: number; course_id: string }>(`
          SELECT c.exam_length_minutes, p.course_id
          FROM problems p
          JOIN courses c ON c.course_id = p.course_id
          WHERE p.exam_id = ? AND p.source_library_id = ?
          LIMIT 1
        `, [examId, libraryId]),
      ]);
      setProblems(probs);
      if (pdfs[0]) setQuestionPdfUrl(convertFileSrc(pdfs[0].absolute_path));
      if (courseData[0]) setExamLengthMinutes(courseData[0].exam_length_minutes ?? 120);

      // Initialize grades with defaults
      const defaultGrades: Record<string, ProblemGrade> = {};
      probs.forEach(p => { defaultGrades[p.pid] = { mastery: 2, outcome: 'correct', notes: '' }; });
      setGrades(defaultGrades);
    };
    load().catch(console.error);
  }, [examId, libraryId]);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // Auto-end when time is up
  useEffect(() => {
    if (sessionStatus === 'active' && elapsedSeconds >= examLengthMinutes * 60) {
      endExam();
    }
  }, [elapsedSeconds, examLengthMinutes, sessionStatus]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const startSession = async () => {
    const now = new Date().toISOString();
    const result = await execute(
      `INSERT INTO exam_sessions (exam_id, source_library_id, started_at, status) VALUES (?, ?, ?, 'in_progress')`,
      [examId, libraryId, now]
    );
    setSessionId(result.lastInsertId ?? null);
    setSessionStartMs(Date.now());
    setSessionStatus('active');
    startTimer();
  };

  const switchProblem = async (pid: string) => {
    if (sessionId === null) return;
    const now = new Date().toISOString();

    if (activePid === pid) {
      // Pause: end current interval
      if (activeIntervalId !== null) {
        await execute(
          `UPDATE exam_session_intervals SET ended_at = ? WHERE id = ?`,
          [now, activeIntervalId]
        );
        await reloadStoredSeconds();
      }
      setActivePid(null);
      setActiveIntervalId(null);
      return;
    }

    // End current interval if any
    if (activeIntervalId !== null) {
      await execute(
        `UPDATE exam_session_intervals SET ended_at = ? WHERE id = ?`,
        [now, activeIntervalId]
      );
    }

    // Start new interval
    const result = await execute(
      `INSERT INTO exam_session_intervals (session_id, pid, course_id, started_at) VALUES (?, ?, ?, ?)`,
      [sessionId, pid, problems.find(p => p.pid === pid)?.course_id ?? '', now]
    );
    await reloadStoredSeconds();
    setActivePid(pid);
    setActiveIntervalId(result.lastInsertId ?? null);
  };

  const reloadStoredSeconds = async () => {
    if (sessionId === null) return;
    const intervals = await select<{ pid: string; started_at: string; ended_at: string | null }>(
      `SELECT pid, started_at, ended_at FROM exam_session_intervals WHERE session_id = ?`,
      [sessionId]
    );
    const totals: Record<string, number> = {};
    for (const iv of intervals) {
      if (!iv.ended_at) continue;
      const secs = (new Date(iv.ended_at).getTime() - new Date(iv.started_at).getTime()) / 1000;
      totals[iv.pid] = (totals[iv.pid] ?? 0) + secs;
    }
    setStoredSeconds(totals);
  };


  const endExam = useCallback(async () => {
    if (sessionId === null) return;
    stopTimer();
    const now = new Date().toISOString();

    // End active interval
    if (activeIntervalId !== null) {
      await execute(`UPDATE exam_session_intervals SET ended_at = ? WHERE id = ?`, [now, activeIntervalId]);
      setActiveIntervalId(null);
    }
    setActivePid(null);
    await reloadStoredSeconds();
    setSessionStatus('grading');
  }, [sessionId, activeIntervalId, stopTimer]);

  const saveResults = async () => {
    if (sessionId === null) return;
    setSessionStatus('saving');
    const now = new Date().toISOString();

    // Reload final stored seconds
    const finalIntervals = await select<{ pid: string; course_id: string; started_at: string; ended_at: string | null }>(
      `SELECT pid, course_id, started_at, ended_at FROM exam_session_intervals WHERE session_id = ?`,
      [sessionId]
    );
    const finalTotals: Record<string, { secs: number; courseId: string }> = {};
    for (const iv of finalIntervals) {
      if (!iv.ended_at) continue;
      const secs = (new Date(iv.ended_at).getTime() - new Date(iv.started_at).getTime()) / 1000;
      if (!finalTotals[iv.pid]) finalTotals[iv.pid] = { secs: 0, courseId: iv.course_id };
      finalTotals[iv.pid].secs += secs;
    }

    // Update session status
    await execute(
      `UPDATE exam_sessions SET ended_at = ?, status = 'completed', notes = ? WHERE id = ?`,
      [now, examNotes || null, sessionId]
    );

    // Save per-problem results + attempts + FSRS
    for (const p of problems) {
      const grade = grades[p.pid];
      if (!grade) continue;
      const totalSecs = Math.round(finalTotals[p.pid]?.secs ?? 0);

      await execute(
        `INSERT OR REPLACE INTO exam_session_problem_results (session_id, pid, course_id, mastery, outcome, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, p.pid, p.course_id, grade.mastery, grade.outcome, grade.notes || null]
      );

      // Fetch FSRS state
      const stateRows = await select<{ stability: number; difficulty: number; last_attempt_at: string | null }>(
        `SELECT stability, difficulty, last_attempt_at FROM problem_state WHERE pid = ? AND course_id = ?`,
        [p.pid, p.course_id]
      );
      const currentState = stateRows[0]?.stability > 0
        ? { stability: stateRows[0].stability, difficulty: stateRows[0].difficulty }
        : null;
      const { nextReview, state } = scheduleFSRS(
        { mastery: grade.mastery, outcome: grade.outcome as any, attemptMode: 'blind_solved', pathQuality: 'reasonable' },
        stateRows[0]?.last_attempt_at ?? null,
        currentState,
      );

      await execute(
        `INSERT INTO attempts (pid, course_id, duration_seconds, attempt_mode, outcome, mastery, notes, created_at)
         VALUES (?, ?, ?, 'exam_session', ?, ?, ?, ?)`,
        [p.pid, p.course_id, totalSecs, grade.outcome, grade.mastery, grade.notes || null, now]
      );

      await execute(`
        INSERT INTO problem_state (
          pid, course_id, current_mastery, stability, difficulty,
          last_attempt_at, next_review_at, total_attempts, total_duration_seconds, last_outcome, last_attempt_mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'exam_session')
        ON CONFLICT(pid, course_id) DO UPDATE SET
          current_mastery = excluded.current_mastery,
          stability = excluded.stability,
          difficulty = excluded.difficulty,
          last_attempt_at = excluded.last_attempt_at,
          next_review_at = excluded.next_review_at,
          total_attempts = total_attempts + 1,
          total_duration_seconds = total_duration_seconds + excluded.total_duration_seconds,
          last_outcome = excluded.last_outcome,
          last_attempt_mode = excluded.last_attempt_mode
      `, [p.pid, p.course_id, grade.mastery, state.stability, state.difficulty,
          now, nextReview.toISOString(), totalSecs, grade.outcome]);
    }

    select<{ value: string }>(`SELECT value FROM settings WHERE key = 'export_auto_enabled'`)
      .then(rows => { if (rows[0]?.value === 'true') exportDailyMarkdown().catch(console.error); })
      .catch(console.error);
    navigate('/exams');
  };

  const remainingSeconds = Math.max(0, examLengthMinutes * 60 - elapsedSeconds);
  const isTimeLow = remainingSeconds < 300 && sessionStatus === 'active';

  if (!examId) return <div className="p-8">Invalid exam parameters.</div>;

  return (
    <div className="flex h-screen bg-muted/30 overflow-hidden">
      {/* PDF area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 py-2 bg-background border-b gap-4 z-10">
          <div>
            <h1 className="font-bold text-sm uppercase">{examId}</h1>
            <p className="text-[11px] text-muted-foreground">Virtual Participation · {examLengthMinutes}min exam</p>
          </div>
          {sessionStatus === 'idle' && (
            <button
              onClick={startSession}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-bold hover:opacity-90"
            >
              <Play className="w-4 h-4" /> Start Exam
            </button>
          )}
          {sessionStatus === 'active' && (
            <button
              onClick={endExam}
              className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-bold hover:opacity-90"
            >
              <Square className="w-4 h-4 fill-current" /> End Exam
            </button>
          )}
          <button
            onClick={() => navigate('/exams')}
            className="p-2 hover:bg-accent rounded-md"
            title="Exit"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-hidden">
          {questionPdfUrl ? (
            <iframe
              src={`${questionPdfUrl}#toolbar=1&navpanes=0&scrollbar=1`}
              className="w-full h-full border-none"
              title="Exam PDF"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No question PDF found for this exam.
            </div>
          )}
        </div>
      </div>

      {/* Floating problem panel */}
      <aside className="w-64 border-l bg-card flex flex-col shadow-xl">
        {/* Timer */}
        <div className={cn(
          'p-4 border-b text-center',
          isTimeLow && 'bg-red-50 dark:bg-red-950/20'
        )}>
          <div className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            {sessionStatus === 'active' ? 'Remaining' : sessionStatus === 'idle' ? 'Exam Length' : 'Time Used'}
          </div>
          <div className={cn(
            'text-3xl font-mono font-bold',
            isTimeLow && 'text-red-600 dark:text-red-400 animate-pulse'
          )}>
            {sessionStatus === 'idle'
              ? formatTime(examLengthMinutes * 60)
              : sessionStatus === 'active'
                ? formatTime(remainingSeconds)
                : formatTime(elapsedSeconds)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Elapsed: {formatTime(elapsedSeconds)}</div>
        </div>

        {/* Problem list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider px-1 mb-2">
            Problems ({problems.length})
          </p>
          {problems.map((p, idx) => {
            const label = p.problem_number != null ? String(p.problem_number) : String(idx + 1);
            const isActive = activePid === p.pid;
            const secs = storedSeconds[p.pid] ?? 0;

            return (
              <button
                key={p.pid}
                onClick={() => sessionStatus === 'active' && switchProblem(p.pid)}
                disabled={sessionStatus !== 'active'}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-left text-sm transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <div className="flex items-center gap-2">
                  {isActive && <span className="w-1.5 h-1.5 bg-primary-foreground rounded-full animate-pulse" />}
                  <span className="font-mono font-bold">P{label}</span>
                  <span className="text-[10px] opacity-70 truncate max-w-[70px]">{p.pid}</span>
                </div>
                <span className="text-[11px] font-mono opacity-80">{formatTime(secs)}</span>
              </button>
            );
          })}
        </div>

        {sessionStatus === 'idle' && (
          <div className="p-3 border-t text-center">
            <p className="text-xs text-muted-foreground">Press "Start Exam" to begin timing</p>
          </div>
        )}
      </aside>

      {/* Grading modal */}
      {(sessionStatus === 'grading' || sessionStatus === 'saving') && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-background border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <header className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" /> Grade Your Exam
                </h2>
                <p className="text-xs text-muted-foreground">Time used: {formatTime(elapsedSeconds)}</p>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {problems.map((p, idx) => {
                const label = p.problem_number != null ? String(p.problem_number) : String(idx + 1);
                const secs = storedSeconds[p.pid] ?? 0;
                const grade = grades[p.pid] ?? { mastery: 2, outcome: 'correct', notes: '' };
                const isExpanded = gradingExpanded === p.pid;

                return (
                  <div key={p.pid} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setGradingExpanded(isExpanded ? null : p.pid)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-sm">P{label}</span>
                        <span className="text-xs text-muted-foreground">{p.pid}</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatTime(secs)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                          M{grade.mastery} · {grade.outcome}
                        </span>
                        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3 bg-muted/20">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase text-muted-foreground">Mastery</label>
                          <div className="flex gap-1">
                            {[0, 1, 2, 3, 4].map(m => (
                              <button key={m}
                                onClick={() => setGrades(g => ({ ...g, [p.pid]: { ...g[p.pid], mastery: m } }))}
                                className={cn(
                                  'flex-1 py-1 text-sm border rounded',
                                  grade.mastery === m ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                                )}>{m}</button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase text-muted-foreground">Outcome</label>
                          <select
                            value={grade.outcome}
                            onChange={e => setGrades(g => ({ ...g, [p.pid]: { ...g[p.pid], outcome: e.target.value } }))}
                            className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                          >
                            {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase text-muted-foreground">Notes</label>
                          <textarea
                            value={grade.notes}
                            onChange={e => setGrades(g => ({ ...g, [p.pid]: { ...g[p.pid], notes: e.target.value } }))}
                            rows={2}
                            placeholder="Key insight, mistake, etc."
                            className="w-full px-2 py-1.5 border rounded bg-background text-xs resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-muted-foreground">Overall Exam Notes</label>
                <textarea
                  value={examNotes}
                  onChange={e => setExamNotes(e.target.value)}
                  rows={3}
                  placeholder="General reflections on this exam session…"
                  className="w-full px-3 py-2 border rounded bg-background text-sm resize-none"
                />
              </div>
            </div>

            <footer className="px-6 py-4 border-t">
              <button
                onClick={saveResults}
                disabled={sessionStatus === 'saving'}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-md font-bold hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {sessionStatus === 'saving' ? 'Saving…' : 'Save & Finish'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamVirtualPage;
