import React, { useEffect, useState, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { useTranslation } from 'react-i18next';
import { select } from '../lib/db';
import {
  Search, Filter, Eye, BookOpen, PlayCircle,
  ChevronUp, ChevronDown, X, BookMarked, RotateCcw, Star, Plus,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSidebarStats } from '../app/providers';
import { execute } from '../lib/db';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Timeline chart for the filter panel
const TimelineChart: React.FC<{
  sortedYears: number[];
  sortedCourses: string[];
  series: { name: string; data: number[] }[];
}> = ({ sortedYears, sortedCourses, series }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || sortedYears.length === 0) return;
    import('echarts').then(echarts => {
      if (!inst.current) inst.current = echarts.init(ref.current!);
      inst.current.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { data: sortedCourses, bottom: 0, type: 'scroll', textStyle: { fontSize: 11 } },
        grid: { left: 36, right: 12, top: 12, bottom: sortedCourses.length > 3 ? 60 : 40 },
        xAxis: { type: 'category', data: sortedYears.map(String), axisLabel: { fontSize: 11 } },
        yAxis: { type: 'value', minInterval: 1, name: 'Exams', nameTextStyle: { fontSize: 10 } },
        series: series.map(s => ({ ...s, type: 'bar', stack: 'total' })),
      }, true);
    });
    return () => { inst.current?.dispose(); inst.current = null; };
  }, [sortedYears, sortedCourses, series]);

  if (sortedYears.length === 0) return null;
  return <div ref={ref} style={{ width: '100%', height: 200 }} />;
};

const SS_SORT_KEY = 'problems_sort_key';
const SS_SORT_DIR = 'problems_sort_dir';
const SS_URL_PARAMS = 'problems_url_params';
const SS_SEARCH = 'problems_search';
const SS_TIME_FROM = 'problems_time_from';
const SS_TIME_TO = 'problems_time_to';
const SS_SEARCH_SCOPE = 'problems_search_scope';

// The table renders one fairly heavy row per problem, so only a slice is mounted
// at a time; the rest is revealed on demand.
const ROW_PAGE_SIZE = 100;

// What the search bar matches: ids/exam/course, L1+L2 topic keywords, or the
// problem statement text.
type SearchScope = 'all' | 'keyword' | 'context';
const SEARCH_SCOPES: { value: SearchScope; label: string; hint: string }[] = [
  { value: 'all', label: 'All', hint: 'Match ids, topics and statement text' },
  { value: 'keyword', label: 'Keyword', hint: 'Match L1 / L2 topics only' },
  { value: 'context', label: 'Context', hint: 'Match the problem statement text only' },
];

function ssGet(key: string, fallback: string): string {
  try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; }
}
function ssSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch {}
}
function ssRemove(...keys: string[]) {
  try { keys.forEach(k => sessionStorage.removeItem(k)); } catch {}
}

interface Problem {
  pid: string;
  exam_id: string;
  course_id: string;
  source_library_id: number | null;
  problem_number: number;
  current_mastery: number | null;
  last_attempt_at: string | null;
  topic_names: string | null;
  search_topics: string | null;
  problem_statement: string | null;
  question_pdf_path: string | null;
  solution_pdf_path: string | null;
}

function twoDigitYear(y: number): number {
  return y >= 50 ? 1900 + y : 2000 + y;
}

function examSortKey(examId: string): number {
  const m = examId.match(/^([a-z]+)(\d{2})$/i);
  if (!m) return 0;
  const semOrder: Record<string, number> = { wi: 0, sp: 1, su: 2, fa: 3 };
  const sem = semOrder[m[1].toLowerCase()] ?? 0;
  return twoDigitYear(parseInt(m[2])) * 10 + sem;
}

function pidSortKey(pid: string): number {
  const dot = pid.lastIndexOf('.');
  if (dot === -1) return 0;
  return examSortKey(pid.slice(0, dot)) * 1000 + (parseInt(pid.slice(dot + 1)) || 0);
}

type SortKey = 'course_id' | 'pid' | 'exam_id' | 'current_mastery' | 'last_attempt_at';
const DEFAULT_SORT_KEY: SortKey = 'course_id';
const DEFAULT_SORT_DIR = 'asc' as const;

const ProblemsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { setStats } = useSidebarStats();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [allExams, setAllExams] = useState<string[]>([]);
  const [allCourses, setAllCourses] = useState<string[]>([]);
  const [allLibraries, setAllLibraries] = useState<{ id: number; name: string }[]>([]);
  const [allLists, setAllLists] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [listItemSet, setListItemSet] = useState<Set<string>>(new Set());
  const [listPopoverKey, setListPopoverKey] = useState<string | null>(null);
  const [popoverMemberIds, setPopoverMemberIds] = useState<Set<number>>(new Set());
  const [inListSet, setInListSet] = useState<Set<string>>(new Set());
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newListName, setNewListName] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const closePopover = useCallback(() => {
    setListPopoverKey(null);
    setShowCreateInput(false);
    setNewListName('');
  }, []);

  useEffect(() => {
    if (!listPopoverKey) return;
    const slash = listPopoverKey.indexOf('/');
    const courseId = listPopoverKey.slice(0, slash);
    const pid = listPopoverKey.slice(slash + 1);
    select<{ list_id: number }>(
      `SELECT list_id FROM list_items WHERE pid = ? AND course_id = ?`, [pid, courseId]
    ).then(rows => setPopoverMemberIds(new Set(rows.map(r => r.list_id))))
      .catch(console.error);
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listPopoverKey, closePopover]);

  const filterExam = searchParams.get('exam') || '';
  const filterCourse = searchParams.get('course') || '';
  const filterLibrary = searchParams.get('library') || '';
  const filterTopic = searchParams.get('topic') || '';
  const filterList = searchParams.get('list') || '';
  const filterMinMastery = searchParams.get('mastery') !== null ? Number(searchParams.get('mastery')) : NaN;

  const [searchTerm, setSearchTerm] = useState(() => ssGet(SS_SEARCH, ''));
  const [searchScope, setSearchScope] = useState<SearchScope>(
    () => ssGet(SS_SEARCH_SCOPE, 'all') as SearchScope
  );
  // Keeps typing responsive: the input updates immediately, the 1000-row list
  // re-filters in a lower-priority render.
  const deferredSearch = useDeferredValue(searchTerm);
  const [visibleCount, setVisibleCount] = useState(ROW_PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>(() => ssGet(SS_SORT_KEY, DEFAULT_SORT_KEY) as SortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => ssGet(SS_SORT_DIR, DEFAULT_SORT_DIR) as 'asc' | 'desc');
  const [timeRangeFrom, setTimeRangeFrom] = useState(() => Number(ssGet(SS_TIME_FROM, '0')) || 0);
  const [timeRangeTo, setTimeRangeTo] = useState(() => Number(ssGet(SS_TIME_TO, '0')) || 0);

  useEffect(() => { ssSet(SS_SORT_KEY, sortKey); }, [sortKey]);
  useEffect(() => { ssSet(SS_SORT_DIR, sortDir); }, [sortDir]);
  useEffect(() => { ssSet(SS_SEARCH, searchTerm); }, [searchTerm]);
  useEffect(() => { ssSet(SS_SEARCH_SCOPE, searchScope); }, [searchScope]);
  useEffect(() => { ssSet(SS_TIME_FROM, String(timeRangeFrom)); }, [timeRangeFrom]);
  useEffect(() => { ssSet(SS_TIME_TO, String(timeRangeTo)); }, [timeRangeTo]);

  useEffect(() => {
    if (!filterList) { setListItemSet(new Set()); return; }
    select<{ pid: string; course_id: string }>(
      `SELECT pid, course_id FROM list_items WHERE list_id = ?`, [filterList]
    ).then(items => setListItemSet(new Set(items.map(i => `${i.course_id}/${i.pid}`))))
      .catch(console.error);
  }, [filterList]);

  // Restore the last used filters when the page is re-entered without explicit
  // query params (e.g. clicking "Problems" in the sidebar after visiting another page).
  const restoringRef = useRef(false);
  useEffect(() => {
    if (Array.from(searchParams.keys()).length > 0) return;
    try {
      const saved = JSON.parse(ssGet(SS_URL_PARAMS, '{}')) as Record<string, string>;
      if (saved && Object.keys(saved).length > 0) {
        restoringRef.current = true;
        setSearchParams(new URLSearchParams(saved), { replace: true });
      }
    } catch { /* ignore malformed stored params */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Skip the mount pass while a restore is in flight, otherwise the empty
    // params of that first render would wipe the stored filters.
    if (restoringRef.current) {
      if (Array.from(searchParams.keys()).length === 0) return;
      restoringRef.current = false;
    }
    const obj: Record<string, string> = {};
    searchParams.forEach((v, k) => { obj[k] = v; });
    ssSet(SS_URL_PARAMS, JSON.stringify(obj));
  }, [searchParams]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [problemData, examData, courseData, libraryData, listsData, membershipData] = await Promise.all([
          select<Problem>(`
            SELECT
              p.pid, p.exam_id, p.course_id, p.source_library_id, p.problem_number,
              p.problem_statement,
              ps.current_mastery, ps.last_attempt_at,
              (SELECT GROUP_CONCAT(name) FROM (
                 SELECT DISTINCT pt.topic_name AS name
                 FROM problem_topics pt
                 WHERE pt.pid = p.pid AND pt.course_id = p.course_id
                 UNION
                 SELECT DISTINCT parent.name AS name
                 FROM problem_topics pt
                 JOIN topic_nodes tn ON tn.id = pt.topic_node_id
                 JOIN topic_nodes parent ON parent.id = tn.parent_id
                 WHERE pt.pid = p.pid AND pt.course_id = p.course_id
               )) as search_topics,
              (SELECT GROUP_CONCAT(pt.topic_name)
               FROM problem_topics pt
               WHERE pt.pid = p.pid AND pt.course_id = p.course_id AND pt.topic_kind = 'confirmed') as topic_names,
              (SELECT pf.absolute_path FROM pdf_files pf
               WHERE pf.exam_id = p.exam_id AND pf.kind = 'question'
                 AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
               ORDER BY pf.is_primary DESC, pf.id ASC LIMIT 1) as question_pdf_path,
              (SELECT pf.absolute_path FROM pdf_files pf
               WHERE pf.exam_id = p.exam_id AND pf.kind = 'solution'
                 AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
               ORDER BY pf.is_primary DESC, pf.id ASC LIMIT 1) as solution_pdf_path
            FROM problems p
            LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
            ORDER BY p.course_id ASC, p.pid ASC
          `),
          select<{ exam_id: string }>('SELECT DISTINCT exam_id FROM problems ORDER BY exam_id'),
          select<{ course_id: string }>('SELECT DISTINCT course_id FROM problems ORDER BY course_id'),
          select<{ id: number; name: string }>('SELECT id, name FROM source_libraries ORDER BY name'),
          select<{ id: number; name: string }>('SELECT id, name FROM problem_lists ORDER BY name'),
          select<{ pid: string; course_id: string }>('SELECT DISTINCT pid, course_id FROM list_items'),
        ]);
        setProblems(problemData);
        setAllExams(examData.map(e => e.exam_id));
        setAllCourses(courseData.map(c => c.course_id));
        setAllLibraries(libraryData);
        setAllLists(listsData);
        setInListSet(new Set(membershipData.map(r => `${r.course_id}/${r.pid}`)));
      } catch (err) {
        console.error('Failed to fetch problems:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const updateFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value);
    else p.delete(key);
    setSearchParams(p, { replace: true });
  };

  const clearAll = () => {
    setSearchParams({}, { replace: true });
    setSearchTerm('');
    setSearchScope('all');
    setSortKey(DEFAULT_SORT_KEY);
    setSortDir(DEFAULT_SORT_DIR);
    setTimeRangeFrom(0);
    setTimeRangeTo(0);
    ssRemove(SS_URL_PARAMS, SS_SORT_KEY, SS_SORT_DIR, SS_SEARCH, SS_TIME_FROM, SS_TIME_TO, SS_SEARCH_SCOPE);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const togglePopoverList = async (listId: number, pid: string, courseId: string) => {
    const isMember = popoverMemberIds.has(listId);
    const key = `${courseId}/${pid}`;
    const newMemberIds = new Set(popoverMemberIds);
    if (isMember) newMemberIds.delete(listId); else newMemberIds.add(listId);
    setPopoverMemberIds(newMemberIds);

    if (isMember) {
      await execute(`DELETE FROM list_items WHERE list_id = ? AND pid = ? AND course_id = ?`, [listId, pid, courseId]);
      if (newMemberIds.size === 0) {
        setInListSet(prev => { const next = new Set(prev); next.delete(key); return next; });
      }
    } else {
      await execute(`INSERT OR IGNORE INTO list_items (list_id, pid, course_id) VALUES (?, ?, ?)`, [listId, pid, courseId]);
      setInListSet(prev => new Set([...prev, key]));
    }
  };

  const createListAndAdd = async (name: string, pid: string, courseId: string) => {
    if (!name.trim()) return;
    const result = await execute('INSERT INTO problem_lists (name) VALUES (?)', [name.trim()]);
    const listId = result.lastInsertId;
    if (listId != null) {
      await execute('INSERT OR IGNORE INTO list_items (list_id, pid, course_id) VALUES (?, ?, ?)', [listId, pid, courseId]);
      const newList = { id: listId, name: name.trim() };
      setAllLists(prev => [...prev, newList].sort((a, b) => a.name.localeCompare(b.name)));
      setPopoverMemberIds(prev => new Set([...prev, listId]));
      setInListSet(prev => new Set([...prev, `${courseId}/${pid}`]));
    }
    setShowCreateInput(false);
    setNewListName('');
  };

  const allExamTimestamps = useMemo(() => {
    const stamps = new Map<number, string>();
    for (const p of problems) {
      const k = examSortKey(p.exam_id);
      if (k > 0 && !stamps.has(k)) {
        const m = p.exam_id.match(/^([a-z]+)(\d{2})$/i);
        if (m) {
          const semNames: Record<string, string> = { wi: 'WI', sp: 'SP', su: 'SU', fa: 'FA' };
          const sem = semNames[m[1].toLowerCase()] ?? m[1].toUpperCase();
          stamps.set(k, `${sem} ${twoDigitYear(parseInt(m[2]))}`);
        }
      }
    }
    return Array.from(stamps.entries()).sort((a, b) => a[0] - b[0]);
  }, [problems]);

  const timelineChartData = useMemo(() => {
    const courseYearSems = new Map<string, Map<number, Set<string>>>();
    const allYearSet = new Set<number>();
    for (const p of problems) {
      const mm = p.exam_id.match(/^([a-z]+)(\d{2})$/i);
      if (!mm) continue;
      const year = twoDigitYear(parseInt(mm[2]));
      const sem = mm[1].toLowerCase();
      const k = examSortKey(p.exam_id);
      if (timeRangeFrom > 0 && k < timeRangeFrom) continue;
      if (timeRangeTo > 0 && k > timeRangeTo) continue;
      allYearSet.add(year);
      if (!courseYearSems.has(p.course_id)) courseYearSems.set(p.course_id, new Map());
      const ym = courseYearSems.get(p.course_id)!;
      if (!ym.has(year)) ym.set(year, new Set());
      ym.get(year)!.add(sem);
    }
    const sortedYears = Array.from(allYearSet).sort();
    const sortedCourses = Array.from(courseYearSems.keys()).sort();
    const series = sortedCourses.map(course => ({
      name: course,
      data: sortedYears.map(year => courseYearSems.get(course)?.get(year)?.size ?? 0),
    }));
    return { sortedYears, sortedCourses, series };
  }, [problems, timeRangeFrom, timeRangeTo]);

  const filtered = useMemo(() => {
    let list = problems;
    if (deferredSearch) {
      const q = deferredSearch.toLowerCase();
      list = list.filter(p => {
        const inKeyword = (p.search_topics ?? '').toLowerCase().includes(q);
        const inContext = (p.problem_statement ?? '').toLowerCase().includes(q);
        if (searchScope === 'keyword') return inKeyword;
        if (searchScope === 'context') return inContext;
        return (
          p.pid.toLowerCase().includes(q) ||
          p.exam_id.toLowerCase().includes(q) ||
          p.course_id.toLowerCase().includes(q) ||
          inKeyword ||
          inContext
        );
      });
    }
    if (filterExam) list = list.filter(p => p.exam_id === filterExam);
    if (filterCourse) list = list.filter(p => p.course_id === filterCourse);
    if (filterLibrary) list = list.filter(p => p.source_library_id === parseInt(filterLibrary));
    if (!isNaN(filterMinMastery)) list = list.filter(p => (p.current_mastery ?? 0) >= filterMinMastery);
    if (filterTopic) {
      list = list.filter(p =>
        p.topic_names?.split(',').some(t => t.trim() === filterTopic)
      );
    }
    if (filterList && listItemSet.size > 0) {
      list = list.filter(p => listItemSet.has(`${p.course_id}/${p.pid}`));
    }
    if (timeRangeFrom > 0 || timeRangeTo > 0) {
      list = list.filter(p => {
        const k = examSortKey(p.exam_id);
        if (k === 0) return timeRangeFrom === 0;
        if (timeRangeFrom > 0 && k < timeRangeFrom) return false;
        if (timeRangeTo > 0 && k > timeRangeTo) return false;
        return true;
      });
    }
    return [...list].sort((a, b) => {
      let va: any;
      let vb: any;
      if (sortKey === 'pid') {
        va = pidSortKey(a.pid);
        vb = pidSortKey(b.pid);
      } else if (sortKey === 'exam_id') {
        va = examSortKey(a.exam_id);
        vb = examSortKey(b.exam_id);
      } else {
        va = a[sortKey] ?? '';
        vb = b[sortKey] ?? '';
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [problems, deferredSearch, searchScope, filterExam, filterCourse, filterLibrary, filterMinMastery, filterTopic, filterList, listItemSet, sortKey, sortDir, timeRangeFrom, timeRangeTo]);

  // Any change to what is being listed starts again from the first page.
  useEffect(() => {
    setVisibleCount(ROW_PAGE_SIZE);
  }, [deferredSearch, searchScope, filterExam, filterCourse, filterLibrary, filterMinMastery,
      filterTopic, filterList, sortKey, sortDir, timeRangeFrom, timeRangeTo]);

  const visibleRows = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Push sidebar stats whenever the filtered list changes
  useEffect(() => {
    const distribution = [0, 0, 0, 0, 0];
    filtered.forEach(p => { distribution[p.current_mastery ?? 0]++; });
    const listName = filterList ? allLists.find(l => String(l.id) === filterList)?.name : undefined;
    setStats({
      total: filtered.length,
      label: listName ? `List: ${listName}` : filterCourse || 'All Problems',
      distribution,
    });
    return () => setStats(null);
  }, [filtered, filterList, filterCourse, allLists, setStats]);

  const activeFiltersCount = [filterExam, filterCourse, filterLibrary, filterTopic, filterList, !isNaN(filterMinMastery) ? '1' : '', timeRangeFrom > 0 || timeRangeTo > 0 ? '1' : ''].filter(Boolean).length;
  const hasNonDefaultSort = sortKey !== DEFAULT_SORT_KEY || sortDir !== DEFAULT_SORT_DIR;
  const showReset = activeFiltersCount > 0 || !!searchTerm || hasNonDefaultSort || searchScope !== 'all';

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const Th = ({ col, label }: { col: SortKey; label: string }) => (
    <th onClick={() => handleSort(col)}
      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:text-foreground select-none">
      <div className="flex items-center gap-1">{label}<SortIcon col={col} /></div>
    </th>
  );

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  return (
    <div className="p-8 space-y-4 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('common.problems')}</h1>
          <p className="text-muted-foreground mt-1">{t('problems.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search id, topic or statement"
                className="pl-10 pr-8 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary w-64"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent text-muted-foreground"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex bg-muted p-0.5 rounded-md self-start">
              {SEARCH_SCOPES.map(scope => (
                <button
                  key={scope.value}
                  onClick={() => setSearchScope(scope.value)}
                  title={scope.hint}
                  className={cn(
                    'px-2 py-0.5 text-[11px] font-medium rounded transition-all',
                    searchScope === scope.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {scope.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowFilters(s => !s)}
            className={cn(
              'p-2 border rounded-md flex items-center gap-1.5 transition-colors',
              showFilters || activeFiltersCount > 0
                ? 'bg-primary text-primary-foreground border-primary'
                : 'hover:bg-accent'
            )}
          >
            <Filter className="w-4 h-4" />
            {activeFiltersCount > 0 && <span className="text-xs font-bold">{activeFiltersCount}</span>}
          </button>
          <button
            onClick={clearAll}
            disabled={!showReset}
            title="Reset all filters and sorting"
            className={cn(
              'p-2 border rounded-md transition-colors',
              showReset
                ? 'hover:bg-accent text-foreground'
                : 'opacity-30 cursor-not-allowed text-muted-foreground'
            )}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('problems.filter_exam')}</label>
              <select
                value={filterExam}
                onChange={e => updateFilter('exam', e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              >
                <option value="">{t('problems.all_exams')}</option>
                {allExams.map(e => <option key={e} value={e}>{e.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('problems.filter_course')}</label>
              <select
                value={filterCourse}
                onChange={e => updateFilter('course', e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              >
                <option value="">{t('problems.all_courses')}</option>
                {allCourses.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">{t('problems.filter_mastery')}</label>
              <select
                value={isNaN(filterMinMastery) ? '' : filterMinMastery}
                onChange={e => updateFilter('mastery', e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background text-sm"
              >
                <option value="">{t('problems.any_mastery')}</option>
                {[0, 1, 2, 3, 4].map(m => <option key={m} value={m}>≥ {m}</option>)}
              </select>
            </div>
            {allLists.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-muted-foreground">List</label>
                <select
                  value={filterList}
                  onChange={e => updateFilter('list', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md bg-background text-sm"
                >
                  <option value="">Any list</option>
                  {allLists.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Timeline chart */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold uppercase text-muted-foreground">Time Range</span>
              <select
                value={timeRangeFrom}
                onChange={e => setTimeRangeFrom(Number(e.target.value))}
                className="px-2 py-1.5 border rounded-md bg-background text-sm"
              >
                <option value={0}>From: All</option>
                {allExamTimestamps.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <span className="text-muted-foreground text-sm">—</span>
              <select
                value={timeRangeTo}
                onChange={e => setTimeRangeTo(Number(e.target.value))}
                className="px-2 py-1.5 border rounded-md bg-background text-sm"
              >
                <option value={0}>To: All</option>
                {allExamTimestamps.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              {(timeRangeFrom > 0 || timeRangeTo > 0) && (
                <button
                  onClick={() => { setTimeRangeFrom(0); setTimeRangeTo(0); }}
                  className="text-xs text-primary hover:underline"
                >
                  Clear range
                </button>
              )}
            </div>
            <TimelineChart
              sortedYears={timelineChartData.sortedYears}
              sortedCourses={timelineChartData.sortedCourses}
              series={timelineChartData.series}
            />
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {filterExam && (
            <Chip label={`Exam: ${filterExam.toUpperCase()}`} onRemove={() => updateFilter('exam', '')} />
          )}
          {filterCourse && (
            <Chip label={`Course: ${filterCourse}`} onRemove={() => updateFilter('course', '')} />
          )}
          {filterLibrary && (
            <Chip
              label={`Library: ${allLibraries.find(l => String(l.id) === filterLibrary)?.name ?? filterLibrary}`}
              onRemove={() => updateFilter('library', '')}
            />
          )}
          {!isNaN(filterMinMastery) && (
            <Chip label={`Mastery ≥ ${filterMinMastery}`} onRemove={() => updateFilter('mastery', '')} />
          )}
          {filterTopic && (
            <Chip label={`Topic: ${filterTopic}`} onRemove={() => updateFilter('topic', '')} />
          )}
          {filterList && (
            <Chip
              label={`List: ${allLists.find(l => String(l.id) === filterList)?.name ?? filterList}`}
              onRemove={() => updateFilter('list', '')}
            />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} / {problems.length} {t('common.problems').toLowerCase()}
        {hasNonDefaultSort && (
          <span className="ml-2 text-primary">
            sorted by {sortKey.replace('_', ' ')} {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </p>

      <div className="bg-card border rounded-lg overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <Th col="course_id" label={t('problems.course')} />
              <Th col="pid" label={t('problems.pid')} />
              <Th col="exam_id" label={t('problems.exam')} />
              <Th col="current_mastery" label={t('problems.mastery')} />
              <Th col="last_attempt_at" label={t('problems.last_attempt')} />
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-right">
                {t('problems.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleRows.map((p) => (
              <tr
                key={`${p.course_id}/${p.pid}`}
                onClick={() => {
                  try {
                    const navList = filtered.map(pr => ({ pid: pr.pid, courseId: pr.course_id }));
                    sessionStorage.setItem('problems_nav_list', JSON.stringify(navList));
                  } catch {}
                  navigate(`/problems/${p.course_id}/${p.pid}`, { state: { from: '/problems' } });
                }}
                className="hover:bg-accent/50 transition-colors group cursor-pointer"
              >
                <td className="px-4 py-3 text-sm font-medium">{p.course_id}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{p.pid}</span>
                    {!!p.solution_pdf_path && (
                      <span title={t('problems.has_solution')}>
                        <BookMarked className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm uppercase text-muted-foreground">{p.exam_id}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1" title={`${p.current_mastery ?? 0} / 4`}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className={cn('w-2 h-2 rounded-full', (p.current_mastery ?? 0) >= i ? 'bg-primary' : 'bg-muted')} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {p.last_attempt_at ? new Date(p.last_attempt_at).toLocaleDateString() : t('problems.never')}
                </td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className={cn('p-1.5 rounded-md hover:bg-accent', !p.question_pdf_path && 'opacity-30 cursor-not-allowed')}
                      title={t('problems.view_problem')}
                      disabled={!p.question_pdf_path}
                      onClick={() => p.question_pdf_path && navigate(`/pdf-viewer?path=${encodeURIComponent(p.question_pdf_path)}&pid=${p.pid}&courseId=${p.course_id}&from=${encodeURIComponent('/problems')}`)}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      className={cn('p-1.5 rounded-md hover:bg-accent', !p.solution_pdf_path && 'opacity-30 cursor-not-allowed')}
                      title={t('problems.view_solution')}
                      disabled={!p.solution_pdf_path}
                      onClick={() => p.solution_pdf_path && navigate(`/pdf-viewer?path=${encodeURIComponent(p.solution_pdf_path)}&pid=${p.pid}&courseId=${p.course_id}&from=${encodeURIComponent('/problems')}`)}
                    >
                      <BookOpen className="w-4 h-4" />
                    </button>
                    <button
                      className={cn('p-1.5 rounded-md hover:bg-accent text-primary', !p.question_pdf_path && !p.solution_pdf_path && 'opacity-30 cursor-not-allowed')}
                      title={t('problems.start_attempt')}
                      disabled={!p.question_pdf_path && !p.solution_pdf_path}
                      onClick={() => {
                        const path = p.question_pdf_path || p.solution_pdf_path;
                        if (path) navigate(`/pdf-viewer?path=${encodeURIComponent(path)}&pid=${p.pid}&courseId=${p.course_id}&mode=attempt&from=${encodeURIComponent('/problems')}`);
                      }}
                    >
                      <PlayCircle className="w-4 h-4" />
                    </button>
                    {/* Save to list */}
                    <div className="relative">
                      <button
                        className="p-1.5 rounded-md hover:bg-accent"
                        title="Save to list"
                        onClick={() => {
                          const key = `${p.course_id}/${p.pid}`;
                          setListPopoverKey(prev => prev === key ? null : key);
                        }}
                      >
                        <Star className={cn('w-4 h-4', inListSet.has(`${p.course_id}/${p.pid}`) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                      </button>
                      {listPopoverKey === `${p.course_id}/${p.pid}` && (
                        <div
                          ref={popoverRef}
                          className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-xl min-w-[200px] overflow-hidden"
                        >
                          <div className="py-1">
                            {allLists.map(l => (
                              <label
                                key={l.id}
                                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={popoverMemberIds.has(l.id)}
                                  onChange={() => togglePopoverList(l.id, p.pid, p.course_id)}
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
                                    if (e.key === 'Enter') createListAndAdd(newListName, p.pid, p.course_id);
                                    if (e.key === 'Escape') { setShowCreateInput(false); setNewListName(''); }
                                  }}
                                  placeholder="List name…"
                                  autoFocus
                                  className="flex-1 min-w-0 px-2 py-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                  onClick={() => createListAndAdd(newListName, p.pid, p.course_id)}
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleCount < filtered.length && (
          <div className="flex items-center justify-center gap-3 p-4 border-t">
            <span className="text-xs text-muted-foreground">
              Showing {visibleRows.length} of {filtered.length}
            </span>
            <button
              onClick={() => setVisibleCount(c => c + ROW_PAGE_SIZE)}
              className="px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
            >
              Show {Math.min(ROW_PAGE_SIZE, filtered.length - visibleCount)} more
            </button>
            <button
              onClick={() => setVisibleCount(filtered.length)}
              className="px-3 py-1.5 text-xs font-medium text-primary hover:underline"
            >
              Show all
            </button>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="p-12 text-center text-muted-foreground">{t('problems.no_results')}</div>
        )}
      </div>
    </div>
  );
};

const Chip = ({ label, onRemove }: { label: string; onRemove: () => void }) => (
  <span className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">
    {label}
    <button onClick={onRemove}><X className="w-3 h-3" /></button>
  </span>
);

export default ProblemsPage;
