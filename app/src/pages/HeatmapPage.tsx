import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { select } from '../lib/db';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MasteryRow {
  exam_id: string;
  problem_number: number;
  current_mastery: number | null;
  pid: string;
  course_id: string;
  source_library_id: number | null;
  library_name: string | null;
}

function twoDigitYear(y: number): number {
  return y >= 50 ? 1900 + y : 2000 + y;
}

function examSortKey(examId: string): number {
  const m = examId.match(/^([a-z]+)(\d{2})$/i);
  if (!m) return 0;
  const semOrder: Record<string, number> = { wi: 0, sp: 1, su: 2, fa: 3 };
  return twoDigitYear(parseInt(m[2])) * 10 + (semOrder[m[1].toLowerCase()] ?? 0);
}

function masteryColor(mastery: number | null) {
  if (mastery === null) return 'bg-muted text-muted-foreground';
  if (mastery === 0) return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-200';
  if (mastery === 1) return 'bg-orange-200 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200';
  if (mastery === 2) return 'bg-yellow-200 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200';
  if (mastery === 3) return 'bg-blue-200 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200';
  return 'bg-green-200 dark:bg-green-900/50 text-green-800 dark:text-green-200';
}

const LEGEND_ITEMS = [
  { label: 'Untouched', cls: 'bg-muted' },
  { label: '0 – Unknown', cls: 'bg-red-200 dark:bg-red-900/50' },
  { label: '1 – Vague', cls: 'bg-orange-200 dark:bg-orange-900/50' },
  { label: '2 – With help', cls: 'bg-yellow-200 dark:bg-yellow-900/50' },
  { label: '3 – Can solve', cls: 'bg-blue-200 dark:bg-blue-900/50' },
  { label: '4 – Fluent', cls: 'bg-green-200 dark:bg-green-900/50' },
];

const HeatmapPage: React.FC = () => {
  const { t } = useTranslation();
  const [masteryRows, setMasteryRows] = useState<MasteryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeExamKey, setActiveExamKey] = useState<string | null>(null);

  useEffect(() => {
    select<MasteryRow>(`
      SELECT p.pid, p.exam_id, p.course_id, p.problem_number, ps.current_mastery,
             p.source_library_id, sl.name AS library_name
      FROM problems p
      LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
      LEFT JOIN source_libraries sl ON p.source_library_id = sl.id
      ORDER BY sl.name, p.exam_id, p.course_id, p.problem_number
    `).then(setMasteryRows)
      .catch(err => console.error('Failed to fetch overview data:', err))
      .finally(() => setLoading(false));
  }, []);

  // exam (source library) → exam_id (semester) → course_id → rows
  const examGroups = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, MasteryRow[]>>>();
    masteryRows.forEach(r => {
      const examName = r.library_name ?? 'Unassigned';
      if (!map.has(examName)) map.set(examName, new Map());
      const semMap = map.get(examName)!;
      if (!semMap.has(r.exam_id)) semMap.set(r.exam_id, new Map());
      const courseMap = semMap.get(r.exam_id)!;
      if (!courseMap.has(r.course_id)) courseMap.set(r.course_id, []);
      courseMap.get(r.course_id)!.push(r);
    });
    return map;
  }, [masteryRows]);

  const examNames = useMemo(
    () => Array.from(examGroups.keys()).sort((a, b) => a.localeCompare(b)),
    [examGroups]
  );

  useEffect(() => {
    if (examNames.length === 0) return;
    if (activeExamKey === null || !examNames.includes(activeExamKey)) {
      setActiveExamKey(examNames[0]);
    }
  }, [examNames, activeExamKey]);

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  const activeSemesters = activeExamKey ? examGroups.get(activeExamKey) : undefined;
  const sortedExamIds = activeSemesters
    ? Array.from(activeSemesters.keys()).sort((a, b) => examSortKey(a) - examSortKey(b))
    : [];

  // Summary stats for the active exam tab
  const activeRows = masteryRows.filter(r => (r.library_name ?? 'Unassigned') === activeExamKey);
  const attempted = activeRows.filter(r => r.current_mastery !== null).length;
  const mastered = activeRows.filter(r => (r.current_mastery ?? 0) >= 3).length;

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('common.heatmap')}</h1>
        <p className="text-muted-foreground mt-1">Mastery overview per exam, by semester.</p>
      </header>

      {examNames.length === 0 ? (
        <div className="text-center text-muted-foreground py-16">No data yet.</div>
      ) : (
        <>
          {/* Exam tabs */}
          <div className="flex gap-1 border-b overflow-x-auto">
            {examNames.map(name => (
              <button
                key={name}
                onClick={() => setActiveExamKey(name)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                  name === activeExamKey
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {name}
              </button>
            ))}
          </div>

          <section className="bg-card border rounded-lg p-6 shadow-sm space-y-4">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {activeExamKey} — Mastery by Semester
              </h2>
              <p className="text-xs text-muted-foreground">
                {activeRows.length} problems · {attempted} attempted · {mastered} at mastery ≥ 3
              </p>
            </div>

            <div className="flex gap-6 items-start">
              {/* Semester rows */}
              <div className="flex-1 space-y-5 min-w-0">
                {sortedExamIds.map(examId => {
                  const courseMap = activeSemesters!.get(examId)!;
                  const courseIds = Array.from(courseMap.keys()).sort();
                  return (
                    <div key={examId}>
                      <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{examId}</p>
                      <div className="flex flex-col gap-2">
                        {courseIds.map(courseId => (
                          <div key={courseId} className="flex items-start gap-3 flex-wrap">
                            <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-[11px] font-semibold flex-shrink-0 mt-0.5">
                              {courseId}
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {courseMap.get(courseId)!.map(row => (
                                <div
                                  key={`${row.course_id}/${row.pid}`}
                                  title={`${row.pid} (${row.course_id}) — Mastery: ${row.current_mastery ?? 'untouched'}`}
                                  className={`w-8 h-8 rounded flex items-center justify-center text-[10px] font-bold cursor-default ${masteryColor(row.current_mastery)}`}
                                >
                                  {row.problem_number}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Floating legend */}
              <div className="sticky top-8 self-start flex-shrink-0 bg-card border rounded-lg p-3 shadow-md space-y-2 min-w-[148px]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Legend</p>
                {LEGEND_ITEMS.map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-3.5 h-3.5 rounded-sm flex-shrink-0 ${item.cls}`} />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default HeatmapPage;
