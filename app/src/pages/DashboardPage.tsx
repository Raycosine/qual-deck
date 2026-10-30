import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { select } from '../lib/db';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Calendar,
  BookOpen,
  Clock,
  Layers,
  AlertCircle,
} from 'lucide-react';

interface SummaryStats {
  dueCount: number;
  overallMastery: number;
  completedThisWeek: number;
  studyMinutesThisWeek: number;
  activeCourses: number;
  neverAttempted: number;
}

interface Activity {
  date: string;
  count: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildCalendarCells(activity: Activity[]) {
  const activityMap = new Map(activity.map((a) => [a.date, a.count]));
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - today.getDay() - 52 * 7);
  const cells: { dateStr: string; count: number; month: number; dayOfWeek: number }[] = [];
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    if (d > today) break;
    const dateStr = d.toISOString().split('T')[0];
    cells.push({ dateStr, count: activityMap.get(dateStr) ?? 0, month: d.getMonth(), dayOfWeek: d.getDay() });
  }
  return cells;
}

function cellColor(count: number) {
  if (count === 0) return 'bg-muted';
  if (count <= 2) return 'bg-primary/25';
  if (count <= 4) return 'bg-primary/50';
  if (count <= 7) return 'bg-primary/75';
  return 'bg-primary';
}

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<SummaryStats>({
    dueCount: 0,
    overallMastery: 0,
    completedThisWeek: 0,
    studyMinutesThisWeek: 0,
    activeCourses: 0,
    neverAttempted: 0,
  });
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const now = new Date().toISOString();
        const [due, mastery, completed, studyTime, courses, never, activityData] = await Promise.all([
          select<{ count: number }>(`
            SELECT COUNT(*) as count FROM problem_state ps
            JOIN problems p ON ps.pid = p.pid AND ps.course_id = p.course_id
            JOIN courses c ON p.course_id = c.course_id
            WHERE ps.next_review_at <= ? AND c.tracking_enabled = 1
          `, [now]),
          select<{ avg: number }>(`
            SELECT CAST(SUM(COALESCE(ps.current_mastery, 0)) AS REAL) / NULLIF(COUNT(p.pid), 0) as avg
            FROM problems p LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
          `),
          select<{ count: number }>(`
            SELECT COUNT(*) as count FROM attempts
            WHERE created_at >= datetime('now', '-7 days')
          `),
          select<{ total: number }>(`
            SELECT COALESCE(SUM(duration_seconds), 0) as total FROM attempts
            WHERE created_at >= datetime('now', '-7 days')
          `),
          select<{ count: number }>(`SELECT COUNT(*) as count FROM courses WHERE tracking_enabled = 1`),
          select<{ count: number }>(`
            SELECT COUNT(*) as count FROM problems p
            LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
            WHERE ps.pid IS NULL
          `),
          select<Activity>(`
            SELECT date(created_at) as date, COUNT(*) as count
            FROM attempts
            GROUP BY date(created_at)
          `),
        ]);

        setStats({
          dueCount: due[0]?.count ?? 0,
          overallMastery: ((mastery[0]?.avg ?? 0) / 4) * 100,
          completedThisWeek: completed[0]?.count ?? 0,
          studyMinutesThisWeek: Math.round((studyTime[0]?.total ?? 0) / 60),
          activeCourses: courses[0]?.count ?? 0,
          neverAttempted: never[0]?.count ?? 0,
        });
        setActivity(activityData);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  const formatStudyTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const cells = buildCalendarCells(activity);
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstDay = week[0];
    if (firstDay && firstDay.month !== lastMonth) {
      monthLabels.push({ weekIndex: wi, label: MONTH_NAMES[firstDay.month] });
      lastMonth = firstDay.month;
    }
  });

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('common.dashboard')}</h1>
        <p className="text-muted-foreground mt-1">Track your progress across qualifying exams.</p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div
          onClick={() => navigate('/reviews')}
          className="bg-card border rounded-lg p-4 space-y-1 cursor-pointer hover:border-primary transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Due Today</span>
            <Calendar className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats.dueCount}</div>
        </div>

        <div className="bg-card border rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Mastery</span>
            <BarChart3 className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats.overallMastery.toFixed(1)}%</div>
        </div>

        <div className="bg-card border rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week</span>
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats.completedThisWeek}</div>
          <div className="text-xs text-muted-foreground">attempts</div>
        </div>

        <div className="bg-card border rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Study Time</span>
            <Clock className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatStudyTime(stats.studyMinutesThisWeek)}</div>
          <div className="text-xs text-muted-foreground">this week</div>
        </div>

        <div
          onClick={() => navigate('/courses')}
          className="bg-card border rounded-lg p-4 space-y-1 cursor-pointer hover:border-primary transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</span>
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats.activeCourses}</div>
          <div className="text-xs text-muted-foreground">courses</div>
        </div>

        <div
          onClick={() => navigate('/problems')}
          className="bg-card border rounded-lg p-4 space-y-1 cursor-pointer hover:border-primary transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Untouched</span>
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{stats.neverAttempted}</div>
          <div className="text-xs text-muted-foreground">never attempted</div>
        </div>
      </div>

      {/* Daily Study Activity Heatmap */}
      <section className="bg-card border rounded-lg p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Daily Study Activity
        </h2>

        <div className="overflow-x-auto">
          <div className="flex ml-8 mb-1" style={{ gap: 3 }}>
            {weeks.map((_, wi) => {
              const label = monthLabels.find((m) => m.weekIndex === wi);
              return (
                <div key={wi} style={{ width: 12, flexShrink: 0 }}>
                  {label ? <span className="text-[9px] text-muted-foreground whitespace-nowrap">{label.label}</span> : null}
                </div>
              );
            })}
          </div>

          <div className="flex" style={{ gap: 3 }}>
            <div className="flex flex-col mr-1" style={{ gap: 3 }}>
              {DAYS.map((d, i) => (
                <div key={d} style={{ height: 12 }} className="text-[9px] text-muted-foreground flex items-center justify-end pr-1 w-7">
                  {i % 2 === 1 ? d.slice(0, 3) : ''}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ gap: 3 }}>
                {Array.from({ length: 7 }, (_, di) => {
                  const cell = week[di];
                  if (!cell) return <div key={di} style={{ width: 12, height: 12 }} />;
                  return (
                    <div
                      key={di}
                      title={`${cell.dateStr}: ${cell.count} attempt${cell.count === 1 ? '' : 's'}`}
                      style={{ width: 12, height: 12 }}
                      className={`rounded-sm ${cellColor(cell.count)}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-1">
            {['bg-muted', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'].map((c) => (
              <div key={c} className={`w-3 h-3 rounded-sm ${c}`} />
            ))}
          </div>
          <span>More</span>
        </div>
      </section>
    </div>
  );
};

export default DashboardPage;
