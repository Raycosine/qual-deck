import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { select } from '../lib/db';
import { Tags, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TopicGroup {
  topic_name: string;
  problem_count: number;
  avg_mastery: number;
  problems: { pid: string; course_id: string; current_mastery: number }[];
  topic_level: number;
  parent_topic_name: string | null;
}

type SortMode = 'count' | 'mastery';

// Returns an inline style opacity for a dot at position i (1-4) given an avg mastery float.
// frac = how much of that dot's "slot" is filled (0–1).
function dotStyle(avgMastery: number, i: number): React.CSSProperties | undefined {
  const frac = Math.max(0, Math.min(1, avgMastery - (i - 1)));
  if (frac <= 0) return undefined; // bg-muted, no override
  if (frac >= 1) return undefined; // bg-primary full, no override
  return { opacity: Math.max(0.2, frac) };
}

function dotClass(avgMastery: number, i: number): string {
  const frac = Math.max(0, Math.min(1, avgMastery - (i - 1)));
  return frac > 0 ? 'bg-primary' : 'bg-muted';
}

const TopicsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<TopicGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});
  const [sortMode, setSortMode] = useState<SortMode>('count');
  const [filterCourse, setFilterCourse] = useState('');
  const [filterLevel, setFilterLevel] = useState<0 | 1 | 2>(0);

  const allCourses = useMemo(() => {
    const set = new Set<string>();
    groups.forEach(g => g.problems.forEach(p => set.add(p.course_id)));
    return [...set].sort();
  }, [groups]);

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const data = await select<any>(`
          SELECT
            pt.topic_name,
            COUNT(p.pid) as problem_count,
            CAST(SUM(COALESCE(ps.current_mastery, 0)) AS REAL) / NULLIF(COUNT(p.pid), 0) as avg_mastery,
            GROUP_CONCAT(p.pid || '|' || p.course_id || ':' || COALESCE(ps.current_mastery, 0)) as problem_data,
            COALESCE(MAX(tn.level), 1) as topic_level,
            MAX(tn_parent.name) as parent_topic_name
          FROM problem_topics pt
          JOIN problems p ON pt.pid = p.pid AND pt.course_id = p.course_id
          LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
          LEFT JOIN topic_nodes tn ON pt.topic_node_id = tn.id
          LEFT JOIN topic_nodes tn_parent ON tn.parent_id = tn_parent.id
          WHERE pt.topic_kind = 'confirmed'
          GROUP BY pt.topic_name
          ORDER BY pt.topic_name ASC
        `);

        const formatted = data.map((row: any) => ({
          topic_name: row.topic_name,
          problem_count: row.problem_count,
          avg_mastery: row.avg_mastery ?? 0,
          problems: (row.problem_data || '').split(',').map((p: string) => {
            const colonIdx = p.lastIndexOf(':');
            const key = p.slice(0, colonIdx);
            const mastery = p.slice(colonIdx + 1);
            const pipeIdx = key.lastIndexOf('|');
            const pid = key.slice(0, pipeIdx);
            const course_id = key.slice(pipeIdx + 1);
            return { pid, course_id, current_mastery: parseInt(mastery) || 0 };
          }),
          topic_level: row.topic_level ?? 1,
          parent_topic_name: row.parent_topic_name ?? null,
        }));

        setGroups(formatted);
      } catch (err) {
        console.error('Failed to fetch topics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTopics();
  }, []);

  const sorted = useMemo(() => {
    let list = [...groups];
    if (filterCourse) list = list.filter(g => g.problems.some(p => p.course_id === filterCourse));
    if (filterLevel === 1) list = list.filter(g => g.topic_level === 1);
    if (filterLevel === 2) list = list.filter(g => g.topic_level === 2);
    return list.sort((a, b) =>
      sortMode === 'count' ? b.problem_count - a.problem_count : b.avg_mastery - a.avg_mastery
    );
  }, [groups, sortMode, filterCourse, filterLevel]);

  const toggleTopic = (name: string) => {
    setExpandedTopics((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('common.topics')}</h1>
          <p className="text-muted-foreground mt-1">{t('topics.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap justify-end">
          {allCourses.length > 1 && (
            <select
              value={filterCourse}
              onChange={e => setFilterCourse(e.target.value)}
              className="px-2 py-1 border rounded-md bg-background text-xs"
              title="Filter by course"
            >
              <option value="">All courses</option>
              {allCourses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <div className="flex bg-muted p-0.5 rounded-md">
            {([0, 1, 2] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-all',
                  filterLevel === lvl
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {lvl === 0 ? 'All' : `L${lvl}`}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{t('topics.sort_by')}:</span>
          <div className="flex bg-muted p-0.5 rounded-md">
            {(['count', 'mastery'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-all',
                  sortMode === mode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {mode === 'count' ? t('topics.sort_count') : t('topics.sort_mastery')}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {sorted.map((group) => (
          <div key={group.topic_name} className="bg-card border rounded-lg overflow-hidden shadow-sm">
            <div className="flex items-center">
              <button
                onClick={() => toggleTopic(group.topic_name)}
                className="flex-1 flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors text-left min-w-0"
              >
                <div className="p-2 bg-primary/5 rounded text-primary flex-shrink-0">
                  <Tags className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold truncate">{group.topic_name}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    {group.problem_count} {t('common.problems').toLowerCase()}
                    {group.topic_level === 2 && group.parent_topic_name && (
                      <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-medium leading-none">
                        {group.parent_topic_name}
                      </span>
                    )}
                  </p>
                </div>
                <div
                  className="hidden sm:flex items-center gap-2 flex-shrink-0"
                  title={`${t('topics.avg_mastery')}: ${group.avg_mastery.toFixed(2)} / 4.0`}
                >
                  <span className="text-xs font-mono text-muted-foreground">
                    {group.avg_mastery.toFixed(1)}
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn('w-2 h-2 rounded-full', dotClass(group.avg_mastery, i))}
                        style={dotStyle(group.avg_mastery, i)}
                      />
                    ))}
                  </div>
                </div>
                <div className="ml-2 flex-shrink-0">
                  {expandedTopics[group.topic_name] ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              <button
                onClick={() => navigate(`/problems?topic=${encodeURIComponent(group.topic_name)}`)}
                className="p-4 hover:bg-accent/50 transition-colors border-l flex-shrink-0"
                title={t('topics.browse')}
              >
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {expandedTopics[group.topic_name] && (
              <div className="p-4 bg-muted/30 border-t grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {group.problems.map((p) => (
                  <button
                    key={`${p.course_id}/${p.pid}`}
                    onClick={() => navigate(`/problems/${p.course_id}/${p.pid}`, { state: { from: '/topics' } })}
                    className="flex flex-col p-2 bg-card border rounded hover:border-primary transition-all text-left"
                  >
                    <span className="text-[10px] font-mono font-bold uppercase truncate">{p.pid}</span>
                    <div className="flex gap-0.5 mt-1.5">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={cn('w-2 h-2 rounded-full', p.current_mastery >= i ? 'bg-primary' : 'bg-muted')}
                        />
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {groups.length === 0 && (
          <div className="p-12 text-center border-2 border-dashed rounded-lg text-muted-foreground">
            {t('topics.no_topics')}
          </div>
        )}
      </div>
    </div>
  );
};

export default TopicsPage;
