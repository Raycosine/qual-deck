import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { select, execute } from '../lib/db';
import {
  ArrowLeft, Eye, BookOpen, PlayCircle,
  Clock, BarChart3, Calendar, AlertTriangle,
  FileText, ChevronLeft, ChevronRight, ChevronDown,
  Tags, Star, Plus, Pencil, Check, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ProblemDetail {
  pid: string;
  exam_id: string;
  course_id: string;
  problem_number: number;
  problem_statement: string;
  evidence: string;
  needs_review: boolean;
  review_reason: string | null;
  current_mastery: number | null;
  total_attempts: number | null;
  last_attempt_at: string | null;
  next_review_at: string | null;
  stability: number | null;
}

interface PdfFile {
  id: number;
  kind: 'question' | 'solution';
  source_filename: string;
  absolute_path: string;
}

interface AttemptRecord {
  id: number;
  duration_seconds: number | null;
  attempt_mode: string | null;
  outcome: string | null;
  mastery: number | null;
  path_quality: string | null;
  notes: string | null;
  created_at: string;
}

const MODE_LABELS: Record<string, string> = {
  blind_solved: 'Blind',
  detour_solved: 'Detour',
  smooth_solved: 'Smooth',
  read_solution_only: 'Read Only',
  reviewed_solution: 'Reviewed',
  skipped: 'Skipped',
};

const OUTCOME_LABELS: Record<string, string> = {
  correct: 'Correct',
  mostly_correct: 'Mostly Correct',
  partial: 'Partial',
  wrong: 'Wrong',
  gave_up: 'Gave Up',
  not_attempted: 'Not Attempted',
};

const OUTCOME_COLOR: Record<string, string> = {
  correct: 'text-green-600 dark:text-green-400',
  mostly_correct: 'text-green-500 dark:text-green-500',
  partial: 'text-yellow-600 dark:text-yellow-400',
  wrong: 'text-red-500',
  gave_up: 'text-red-400',
  not_attempted: 'text-muted-foreground',
};

function formatDuration(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? (sec > 0 ? `${m}m ${sec}s` : `${m}m`) : `${sec}s`;
}

const ProblemDetailPage: React.FC = () => {
  const { courseId, pid } = useParams<{ courseId: string; pid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [pdfs, setPdfs] = useState<PdfFile[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [prevEntry, setPrevEntry] = useState<{ pid: string; courseId: string } | null>(null);
  const [nextEntry, setNextEntry] = useState<{ pid: string; courseId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const [allLists, setAllLists] = useState<{ id: number; name: string }[]>([]);
  const [memberListIds, setMemberListIds] = useState<Set<number>>(new Set());
  const [starOpen, setStarOpen] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newListName, setNewListName] = useState('');
  const starRef = useRef<HTMLDivElement | null>(null);

  const toggleNote = useCallback((id: number) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const startEditNote = useCallback((attempt: AttemptRecord) => {
    setEditingNoteId(attempt.id);
    setNoteDraft(attempt.notes ?? '');
    setExpandedNotes(prev => new Set(prev).add(attempt.id));
  }, []);

  const saveNote = useCallback(async (attemptId: number) => {
    const value = noteDraft.trim();
    await execute('UPDATE attempts SET notes = ? WHERE id = ?', [value || null, attemptId]);
    setAttempts(prev => prev.map(a => (a.id === attemptId ? { ...a, notes: value || null } : a)));
    setEditingNoteId(null);
  }, [noteDraft]);

  const goBack = useCallback(
    () => navigate((location.state as any)?.from || '/problems'),
    [navigate, location.state]
  );

  useEffect(() => {
    if (!pid || !courseId) return;
    setLoading(true);

    const fetchData = async () => {
      try {
        const [problemData, attemptData, topicsData] = await Promise.all([
          select<ProblemDetail>(`
            SELECT p.*, ps.current_mastery, ps.total_attempts, ps.last_attempt_at,
                   ps.next_review_at, ps.stability
            FROM problems p
            LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
            WHERE p.pid = ? AND p.course_id = ?
          `, [pid, courseId]),
          select<AttemptRecord>(`
            SELECT id, duration_seconds, attempt_mode, outcome, mastery, path_quality, notes, created_at
            FROM attempts WHERE pid = ? AND course_id = ? ORDER BY created_at DESC
          `, [pid, courseId]),
          select<{ topic_name: string }>(`
            SELECT DISTINCT topic_name FROM problem_topics
            WHERE pid = ? AND course_id = ? AND topic_kind = 'confirmed'
            ORDER BY topic_name
          `, [pid, courseId]),
        ]);

        // Context-aware prev/next: use sessionStorage nav list from ProblemsPage, fallback to DB
        let prevResolved = false;
        try {
          const stored = sessionStorage.getItem('problems_nav_list');
          if (stored) {
            const list: { pid: string; courseId: string }[] = JSON.parse(stored);
            const idx = list.findIndex(item => item.pid === pid && item.courseId === courseId);
            if (idx !== -1) {
              setPrevEntry(idx > 0 ? list[idx - 1] : null);
              setNextEntry(idx < list.length - 1 ? list[idx + 1] : null);
              prevResolved = true;
            }
          }
        } catch {}

        if (!prevResolved) {
          const [prevData, nextData] = await Promise.all([
            select<{ pid: string; course_id: string }>(`
              SELECT pid, course_id FROM problems
              WHERE course_id = ? AND pid < ? ORDER BY pid DESC LIMIT 1
            `, [courseId, pid]),
            select<{ pid: string; course_id: string }>(`
              SELECT pid, course_id FROM problems
              WHERE course_id = ? AND pid > ? ORDER BY pid ASC LIMIT 1
            `, [courseId, pid]),
          ]);
          setPrevEntry(prevData[0] ? { pid: prevData[0].pid, courseId: prevData[0].course_id } : null);
          setNextEntry(nextData[0] ? { pid: nextData[0].pid, courseId: nextData[0].course_id } : null);
        }

        if (problemData.length > 0) {
          setProblem(problemData[0]);
          const pdfData = await select<PdfFile>(`
            SELECT pf.id, pf.kind, pf.source_filename, pf.absolute_path
            FROM pdf_files pf
            JOIN problems p ON pf.exam_id = p.exam_id
            WHERE p.pid = ? AND p.course_id = ?
              AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
            ORDER BY pf.kind, pf.source_filename
          `, [pid, courseId]);
          setPdfs(pdfData);
        }

        setAttempts(attemptData);
        setTopics(topicsData.map(t => t.topic_name));

        const [listsData, memberData] = await Promise.all([
          select<{ id: number; name: string }>('SELECT id, name FROM problem_lists ORDER BY name'),
          select<{ list_id: number }>(
            'SELECT list_id FROM list_items WHERE pid = ? AND course_id = ?',
            [pid, courseId]
          ),
        ]);
        setAllLists(listsData);
        setMemberListIds(new Set(memberData.map(r => r.list_id)));
      } catch (err) {
        console.error('Failed to fetch problem detail:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [pid, courseId]);

  const toggleList = async (listId: number) => {
    if (!pid || !courseId) return;
    if (memberListIds.has(listId)) {
      await execute('DELETE FROM list_items WHERE list_id = ? AND pid = ? AND course_id = ?', [listId, pid, courseId]);
      setMemberListIds(prev => { const next = new Set(prev); next.delete(listId); return next; });
    } else {
      await execute('INSERT OR IGNORE INTO list_items (list_id, pid, course_id) VALUES (?, ?, ?)', [listId, pid, courseId]);
      setMemberListIds(prev => new Set([...prev, listId]));
    }
  };

  const createListAndAdd = async (name: string) => {
    if (!name.trim() || !pid || !courseId) return;
    const result = await execute('INSERT INTO problem_lists (name) VALUES (?)', [name.trim()]);
    const listId = result.lastInsertId;
    if (listId != null) {
      await execute('INSERT OR IGNORE INTO list_items (list_id, pid, course_id) VALUES (?, ?, ?)', [listId, pid, courseId]);
      setAllLists(prev => [...prev, { id: listId, name: name.trim() }].sort((a, b) => a.name.localeCompare(b.name)));
      setMemberListIds(prev => new Set([...prev, listId]));
    }
    setShowCreateInput(false);
    setNewListName('');
  };

  useEffect(() => {
    if (!starOpen) return;
    const handler = (e: MouseEvent) => {
      if (starRef.current && !starRef.current.contains(e.target as Node)) {
        setStarOpen(false);
        setShowCreateInput(false);
        setNewListName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [starOpen]);

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;
  if (!problem) return <div className="p-8 text-center text-destructive">Problem not found.</div>;

  const questions = pdfs.filter((f) => f.kind === 'question');
  const solutions = pdfs.filter((f) => f.kind === 'solution');

  const openPdf = (path: string, mode?: string) => {
    const from = encodeURIComponent(`/problems/${problem.course_id}/${problem.pid}`);
    const url = `/pdf-viewer?path=${encodeURIComponent(path)}&pid=${problem.pid}&courseId=${problem.course_id}${mode ? `&mode=${mode}` : ''}&from=${from}`;
    navigate(url);
  };

  const startAttempt = () => {
    if (questions.length > 0) {
      openPdf(questions[0].absolute_path, 'attempt');
    } else if (solutions.length > 0) {
      openPdf(solutions[0].absolute_path, 'attempt');
    }
  };

  const intervalDays = problem.stability != null && problem.stability > 0
    ? Math.max(1, Math.round(problem.stability))
    : null;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      {/* Top nav row */}
      <div className="flex items-center justify-between">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> {t('common.back')}
        </button>

        <div className="flex items-center gap-1">
          <button
            disabled={!prevEntry}
            onClick={() => prevEntry && navigate(`/problems/${prevEntry.courseId}/${prevEntry.pid}`, { state: { from: (location.state as any)?.from ?? '/problems' } })}
            className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous Problem"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            disabled={!nextEntry}
            onClick={() => nextEntry && navigate(`/problems/${nextEntry.courseId}/${nextEntry.pid}`, { state: { from: (location.state as any)?.from ?? '/problems' } })}
            className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next Problem"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold font-mono">{problem.pid}</h1>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-primary/10 text-primary">
              {problem.course_id}
            </span>
            {!!problem.needs_review && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs font-bold rounded uppercase">
                <AlertTriangle className="w-3 h-3" /> Needs Review
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span className="uppercase font-semibold">{problem.exam_id}</span>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <button
            disabled={questions.length === 0}
            onClick={() => questions[0] && openPdf(questions[0].absolute_path)}
            className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-accent disabled:opacity-50"
          >
            <Eye className="w-4 h-4" /> View Problem
          </button>
          <button
            disabled={solutions.length === 0}
            onClick={() => solutions[0] && openPdf(solutions[0].absolute_path)}
            className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-accent disabled:opacity-50"
          >
            <BookOpen className="w-4 h-4" /> View Solution
          </button>
          <button
            disabled={questions.length === 0 && solutions.length === 0}
            onClick={startAttempt}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            <PlayCircle className="w-4 h-4" /> Start Attempt
          </button>
          {/* Save to list */}
          <div className="relative" ref={starRef}>
            <button
              onClick={() => setStarOpen(o => !o)}
              className="p-2 border rounded-md hover:bg-accent"
              title="Save to list"
            >
              <Star className={cn('w-4 h-4', memberListIds.size > 0 ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
            </button>
            {starOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-xl min-w-[220px] overflow-hidden">
                <div className="py-1">
                  {allLists.map(l => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={memberListIds.has(l.id)}
                        onChange={() => toggleList(l.id)}
                        className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
                      />
                      <span className="text-sm truncate">{l.name}</span>
                    </label>
                  ))}
                  {allLists.length === 0 && !showCreateInput && (
                    <div className="px-3 py-1.5 text-xs text-muted-foreground">No lists yet</div>
                  )}
                </div>
                <div className="border-t">
                  {showCreateInput ? (
                    <div className="px-3 py-2 flex items-center gap-1">
                      <input
                        type="text"
                        value={newListName}
                        onChange={e => setNewListName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') createListAndAdd(newListName);
                          if (e.key === 'Escape') { setShowCreateInput(false); setNewListName(''); }
                        }}
                        placeholder="List name…"
                        autoFocus
                        className="flex-1 min-w-0 px-2 py-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={() => createListAndAdd(newListName)}
                        disabled={!newListName.trim()}
                        className="p-1 rounded bg-primary text-primary-foreground disabled:opacity-40"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent"
                      onClick={() => setShowCreateInput(true)}
                    >
                      <Plus className="w-3.5 h-3.5" /> Create a new list
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Problem Statement */}
          {problem.problem_statement && (
            <section className="bg-card border rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold border-b pb-2">Problem Statement</h2>
              <div className="whitespace-pre-wrap font-serif text-lg leading-relaxed">
                {problem.problem_statement}
              </div>
            </section>
          )}

          {problem.review_reason && (
            <section className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-sm text-yellow-800 dark:text-yellow-300">
              <h3 className="font-bold flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4" /> Review Reason
              </h3>
              {problem.review_reason}
            </section>
          )}

          {/* Topics (collapsible) */}
          <section className="bg-card border rounded-lg overflow-hidden">
            <button
              onClick={() => setTopicsExpanded(e => !e)}
              className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Tags className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Topics</h2>
                {topics.length > 0 && (
                  <span className="text-xs text-muted-foreground">({topics.length})</span>
                )}
              </div>
              <ChevronDown className={cn('w-4 h-4 transition-transform', topicsExpanded && 'rotate-180')} />
            </button>
            {topicsExpanded && (
              <div className="px-4 pb-4 pt-2 border-t">
                {topics.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No topics assigned.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {topics.map(topic => (
                      <button
                        key={topic}
                        onClick={() => navigate(`/problems?topic=${encodeURIComponent(topic)}`)}
                        className="px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium hover:bg-primary/20 transition-colors"
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Attempt History */}
          <section className="bg-card border rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold border-b pb-2">
              Attempt History
              {attempts.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({attempts.length})</span>
              )}
            </h2>
            {attempts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No attempts recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {attempts.map((a) => (
                  <div key={a.id} className="rounded-md bg-muted/40 overflow-hidden">
                    <div className="flex items-center justify-between p-3 text-sm gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-xs font-medium bg-accent px-1.5 py-0.5 rounded">
                          {MODE_LABELS[a.attempt_mode ?? ''] ?? a.attempt_mode ?? '—'}
                        </span>
                        <span className={cn('text-xs font-medium', OUTCOME_COLOR[a.outcome ?? ''] ?? 'text-muted-foreground')}>
                          {OUTCOME_LABELS[a.outcome ?? ''] ?? a.outcome ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {a.mastery !== null && (
                          <div className="flex gap-0.5" title={`Mastery: ${a.mastery} / 4`}>
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className={cn('w-2 h-2 rounded-full', (a.mastery ?? 0) >= i ? 'bg-primary' : 'bg-muted')} />
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDuration(a.duration_seconds)}</span>
                        <button
                          onClick={() => toggleNote(a.id)}
                          className={cn(
                            'p-0.5 rounded hover:bg-accent transition-colors',
                            expandedNotes.has(a.id) ? 'text-primary' : a.notes ? 'text-muted-foreground' : 'text-muted-foreground/40'
                          )}
                          title={expandedNotes.has(a.id) ? 'Hide note' : a.notes ? 'Show note' : 'Add a note'}
                        >
                          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expandedNotes.has(a.id) && 'rotate-180')} />
                        </button>
                      </div>
                    </div>
                    {expandedNotes.has(a.id) && (
                      <div className="px-3 pb-3 pt-2 border-t space-y-2">
                        {editingNoteId === a.id ? (
                          <>
                            <textarea
                              value={noteDraft}
                              onChange={e => setNoteDraft(e.target.value)}
                              autoFocus
                              rows={4}
                              placeholder="What happened in this attempt?"
                              className="w-full px-2 py-1.5 border rounded-md bg-background text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveNote(a.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90"
                              >
                                <Check className="w-3 h-3" /> Save
                              </button>
                              <button
                                onClick={() => setEditingNoteId(null)}
                                className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium hover:bg-accent"
                              >
                                <X className="w-3 h-3" /> Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <p className={cn(
                              'text-xs whitespace-pre-wrap leading-relaxed flex-1',
                              a.notes ? 'text-muted-foreground' : 'text-muted-foreground/60 italic'
                            )}>
                              {a.notes || 'No note for this attempt.'}
                            </p>
                            <button
                              onClick={() => startEditNote(a)}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground flex-shrink-0"
                              title={a.notes ? 'Edit note' : 'Add note'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {/* Stats */}
          <section className="bg-card border rounded-lg p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stats</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><BarChart3 className="w-4 h-4" /> Mastery</span>
                <div className="flex gap-1" title={`${problem.current_mastery ?? 0} / 4`}>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={cn('w-2 h-2 rounded-full', (problem.current_mastery ?? 0) >= i ? 'bg-primary' : 'bg-muted')} />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4" /> Attempts</span>
                <span className="font-bold">{problem.total_attempts ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><Calendar className="w-4 h-4" /> Last Attempt</span>
                <span className="text-sm">
                  {problem.last_attempt_at ? new Date(problem.last_attempt_at).toLocaleDateString() : 'Never'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm"><Calendar className="w-4 h-4" /> Next Review</span>
                <span className="text-sm font-medium text-primary">
                  {problem.next_review_at ? new Date(problem.next_review_at).toLocaleDateString() : 'Not scheduled'}
                </span>
              </div>
              {intervalDays !== null && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">Interval</span>
                  <span className="text-sm text-muted-foreground">{intervalDays}d</span>
                </div>
              )}
            </div>
          </section>

          {/* PDF Files */}
          <section className="bg-card border rounded-lg p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">PDF Files</h2>
            {pdfs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No PDFs found for this exam.</p>
            ) : (
              <div className="space-y-1">
                {pdfs.map((pdf) => (
                  <button
                    key={pdf.id}
                    onClick={() => openPdf(pdf.absolute_path)}
                    className="w-full text-left p-2 rounded hover:bg-accent text-xs truncate flex items-center gap-2"
                    title={pdf.source_filename}
                  >
                    {pdf.kind === 'question' ? <FileText className="w-3 h-3 flex-shrink-0" /> : <BookOpen className="w-3 h-3 flex-shrink-0" />}
                    <span className="truncate">{pdf.source_filename}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

        </aside>
      </div>
    </div>
  );
};

export default ProblemDetailPage;
