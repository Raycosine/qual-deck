import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, StickyNote, X } from 'lucide-react';
import { select, execute } from '../../lib/db';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type NoteKind = 'problem' | 'solution';

interface ProblemRow {
  pid: string;
  course_id: string;
  problem_number: number;
}

interface Props {
  examId: string | null;
  libraryId: number | null;
  /** Which PDF is on screen: notes of the matching kind are the only ones shown. */
  kind: NoteKind;
  /** Set when the viewer was opened from a single problem. */
  focusPid?: string | null;
  focusCourseId?: string | null;
  /** True when entered from a whole exam: every note starts expanded. */
  expandAll: boolean;
}

const noteKey = (pid: string, courseId: string) => `${courseId}/${pid}`;

const SAVE_DEBOUNCE_MS = 500;

const PdfNotesPanel: React.FC<Props> = ({
  examId, libraryId, kind, focusPid, focusCourseId, expandAll,
}) => {
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<ProblemRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const initialised = useRef(false);

  // Problems belonging to the exam currently on screen.
  useEffect(() => {
    if (!examId) { setProblems([]); return; }
    select<ProblemRow>(`
      SELECT pid, course_id, problem_number
      FROM problems
      WHERE exam_id = ?
        AND ((? IS NULL AND source_library_id IS NULL) OR source_library_id = ?)
      ORDER BY problem_number, course_id
    `, [examId, libraryId, libraryId])
      .then(setProblems)
      .catch(err => console.error('Failed to load problems for notes:', err));
  }, [examId, libraryId]);

  // Notes for the kind of PDF being displayed.
  useEffect(() => {
    if (problems.length === 0) { setNotes({}); return; }
    select<{ pid: string; course_id: string; note: string }>(
      `SELECT pid, course_id, note FROM problem_notes WHERE kind = ?`, [kind]
    ).then(rows => {
      const map: Record<string, string> = {};
      rows.forEach(r => { map[noteKey(r.pid, r.course_id)] = r.note ?? ''; });
      setNotes(map);
    }).catch(err => console.error('Failed to load notes:', err));
  }, [problems, kind]);

  // Entry mode decides what starts expanded: one problem, or all of them.
  useEffect(() => {
    if (problems.length === 0 || initialised.current) return;
    initialised.current = true;
    if (expandAll || !focusPid) {
      setExpanded(new Set(problems.map(p => noteKey(p.pid, p.course_id))));
    } else {
      setExpanded(new Set([noteKey(focusPid, focusCourseId || '')]));
    }
  }, [problems, expandAll, focusPid, focusCourseId]);

  useEffect(() => {
    const pending = timers.current;
    return () => { Object.values(pending).forEach(clearTimeout); };
  }, []);

  const persist = useCallback(async (pid: string, courseId: string, value: string) => {
    const k = noteKey(pid, courseId);
    setSavingKeys(prev => new Set(prev).add(k));
    try {
      await execute(`
        INSERT INTO problem_notes (pid, course_id, kind, note, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(pid, course_id, kind) DO UPDATE SET
          note = excluded.note,
          updated_at = excluded.updated_at
      `, [pid, courseId, kind, value]);
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setSavingKeys(prev => { const next = new Set(prev); next.delete(k); return next; });
    }
  }, [kind]);

  const onChangeNote = (pid: string, courseId: string, value: string) => {
    const k = noteKey(pid, courseId);
    setNotes(prev => ({ ...prev, [k]: value }));
    if (timers.current[k]) clearTimeout(timers.current[k]);
    timers.current[k] = setTimeout(() => {
      delete timers.current[k];
      persist(pid, courseId, value);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushNote = (pid: string, courseId: string) => {
    const k = noteKey(pid, courseId);
    if (!timers.current[k]) return;
    clearTimeout(timers.current[k]);
    delete timers.current[k];
    persist(pid, courseId, notes[k] ?? '');
  };

  const toggle = (k: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const multiCourse = useMemo(
    () => new Set(problems.map(p => p.course_id)).size > 1,
    [problems]
  );

  const filledCount = problems.filter(p => (notes[noteKey(p.pid, p.course_id)] ?? '').trim()).length;
  const label = kind === 'solution' ? 'Solution' : 'Problem';

  if (!examId) return null;

  return (
    <>
      {/* Notes panel — floats over the right edge of the PDF, scrolls on its own */}
      {open && (
        <div
          className="absolute top-4 bottom-20 right-[5%] w-[25%] min-w-[220px] max-w-[460px] z-20
                     flex flex-col rounded-lg border bg-background/95 backdrop-blur shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b flex-shrink-0">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {label} Notes
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {filledCount}/{problems.length}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                title="Hide notes"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-2">
            {problems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic p-2">No problems for this exam.</p>
            ) : (
              problems.map(p => {
                const k = noteKey(p.pid, p.course_id);
                const isOpen = expanded.has(k);
                const isFocus = focusPid === p.pid && (focusCourseId ?? '') === p.course_id;
                const value = notes[k] ?? '';
                return (
                  <div
                    key={k}
                    className={cn(
                      'rounded-md border border-amber-300/70 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800/60',
                      isFocus && 'ring-2 ring-primary/60'
                    )}
                  >
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <button
                        onClick={() => toggle(k)}
                        className="p-0.5 rounded hover:bg-amber-200/60 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200"
                        title={isOpen ? 'Collapse' : 'Expand'}
                      >
                        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isOpen && '-rotate-90')} />
                      </button>
                      <span className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                        {label} {p.problem_number}
                      </span>
                      {multiCourse && (
                        <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100">
                          {p.course_id}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-amber-700/80 dark:text-amber-300/80">
                        {savingKeys.has(k) ? 'saving…' : value.trim() ? '●' : ''}
                      </span>
                    </div>
                    {isOpen && (
                      <div className="px-2 pb-2">
                        <textarea
                          value={value}
                          onChange={e => onChangeNote(p.pid, p.course_id, e.target.value)}
                          onBlur={() => flushNote(p.pid, p.course_id)}
                          rows={4}
                          placeholder={`Notes for ${label.toLowerCase()} ${p.problem_number}…`}
                          className="w-full px-2 py-1.5 rounded border border-amber-300/70 dark:border-amber-800/60
                                     bg-amber-100/50 dark:bg-amber-950/60 text-xs leading-relaxed
                                     text-amber-950 dark:text-amber-50 placeholder:text-amber-700/50
                                     focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'absolute bottom-4 right-4 z-30 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors',
          open ? 'bg-muted text-foreground border' : 'bg-primary text-primary-foreground hover:opacity-90'
        )}
        title={open ? 'Hide notes' : `Show ${label.toLowerCase()} notes`}
      >
        {open ? <X className="w-5 h-5" /> : <StickyNote className="w-5 h-5" />}
      </button>
    </>
  );
};

export default PdfNotesPanel;
