import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { select } from '../../lib/db';
import { useNotificationsAndTray } from '../../features/notifications/useNotifications';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Tags,
  Calendar,
  Flame,
  Settings,
  Moon,
  Sun,
  Languages,
  GraduationCap,
  List,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApp, useSidebarStats } from '../../app/providers';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MASTERY_COLORS = ['bg-muted', 'bg-red-400', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'];
const MASTERY_LABELS = ['Untouched/0', '1 – Vague', '2 – With help', '3 – Can solve', '4 – Fluent'];

const ACTIVE_EXAMS_KEY = 'sidebar_active_exams';

interface ExamMasteryRow {
  lib_id: number;
  exam_name: string;
  mastery: number;
  cnt: number;
}

function MasteryBar({ distribution, total }: { distribution: number[]; total: number }) {
  return (
    <div className="flex rounded overflow-hidden h-2.5 bg-muted">
      {distribution.map((count, i) =>
        count > 0 ? (
          <div
            key={i}
            className={cn(MASTERY_COLORS[i], 'transition-all')}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${MASTERY_LABELS[i]}: ${count}`}
          />
        ) : null
      )}
    </div>
  );
}

// Always-on mastery widget: overall distribution with per-exam (source library)
// legend toggles, ECharts-legend style.
const SidebarMasteryWidget: React.FC = () => {
  const { stats } = useSidebarStats();
  const location = useLocation();
  const [rows, setRows] = useState<ExamMasteryRow[]>([]);
  const [inactive, setInactive] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_EXAMS_KEY);
      return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
    } catch {
      return new Set<number>();
    }
  });

  useEffect(() => {
    select<ExamMasteryRow>(`
      SELECT
        COALESCE(p.source_library_id, 0) AS lib_id,
        COALESCE(sl.name, 'Unassigned') AS exam_name,
        COALESCE(ps.current_mastery, 0) AS mastery,
        COUNT(*) AS cnt
      FROM problems p
      LEFT JOIN source_libraries sl ON p.source_library_id = sl.id
      LEFT JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
      GROUP BY lib_id, exam_name, mastery
    `).then(setRows).catch(err => console.error('Failed to load sidebar mastery:', err));
  }, [location.pathname]);

  const exams = useMemo(() => {
    const map = new Map<number, string>();
    rows.forEach(r => map.set(r.lib_id, r.exam_name));
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const toggleExam = (id: number) => {
    setInactive(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Never deactivate every exam — that would leave nothing to show.
      if (next.size === exams.length) return prev;
      try { localStorage.setItem(ACTIVE_EXAMS_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const { distribution, total, label } = useMemo(() => {
    const dist = [0, 0, 0, 0, 0];
    let tot = 0;
    rows.forEach(r => {
      if (inactive.has(r.lib_id)) return;
      const m = Math.min(Math.max(r.mastery ?? 0, 0), 4);
      dist[m] += r.cnt;
      tot += r.cnt;
    });
    const activeNames = exams.filter(e => !inactive.has(e.id)).map(e => e.name);
    return {
      distribution: dist,
      total: tot,
      label: activeNames.length === exams.length ? 'All Problems' : activeNames.join(' · '),
    };
  }, [rows, inactive, exams]);

  if (exams.length === 0) return null;

  const mastered = distribution[3] + distribution[4];
  const masteredPct = total > 0 ? Math.round((mastered / total) * 100) : 0;

  return (
    <div className="mx-3 mb-2 p-3 bg-muted/50 rounded-lg border space-y-2">
      {/* Filtered view from ProblemsPage, when available */}
      {stats && stats.total > 0 && (
        <div className="space-y-1.5 pb-2 border-b">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground truncate">{stats.label}</span>
            <span className="text-[11px] font-mono font-bold text-primary">
              {Math.round((((stats.distribution[3] ?? 0) + (stats.distribution[4] ?? 0)) / stats.total) * 100)}%
            </span>
          </div>
          <MasteryBar distribution={stats.distribution} total={stats.total} />
          <div className="text-[10px] text-muted-foreground">{stats.total} problems in view</div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground truncate" title={label}>{label}</span>
        <span className="text-[11px] font-mono font-bold text-primary">{masteredPct}%</span>
      </div>

      <MasteryBar distribution={distribution} total={total || 1} />

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{total} problems</span>
        <span>{mastered} mastered</span>
      </div>

      {/* Exam legend — click to activate/deactivate */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t">
        {exams.map(exam => {
          const active = !inactive.has(exam.id);
          return (
            <button
              key={exam.id}
              onClick={() => toggleExam(exam.id)}
              title={active ? `Hide ${exam.name}` : `Show ${exam.name}`}
              className={cn(
                'text-[10px] font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground/50 line-through'
              )}
            >
              {exam.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const Layout: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useApp();
  useNotificationsAndTray();

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('common.dashboard') },
    { to: '/courses', icon: BookOpen, label: t('common.courses') },
    { to: '/exams', icon: GraduationCap, label: 'Exams' },
    { to: '/problems', icon: FileText, label: t('common.problems') },
    { to: '/lists', icon: List, label: 'Lists' },
    { to: '/topics', icon: Tags, label: t('common.topics') },
    { to: '/reviews', icon: Calendar, label: t('common.reviews') },
    { to: '/heatmap', icon: Flame, label: t('common.heatmap') },
    { to: '/settings', icon: Settings, label: t('common.settings') },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="text-primary">Σ</span> QualDeck
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Mastery widget — always visible, with per-exam legend toggles */}
        <SidebarMasteryWidget />

        <div className="p-4 border-t space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-md hover:bg-accent transition-colors"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
              className="p-2 rounded-md hover:bg-accent transition-colors flex items-center gap-2"
              title="Toggle Language"
            >
              <Languages className="w-5 h-5" />
              <span className="text-sm font-medium uppercase">{language}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
