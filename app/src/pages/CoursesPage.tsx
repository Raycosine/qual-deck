import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { select, execute } from '../lib/db';
import {
  BookOpen,
  Settings2,
  CheckCircle2,
  Circle,
  Bell,
  BellOff,
  Save,
  X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Course {
  course_id: string;
  title: string;
  description: string | null;
  tracking_enabled: number;
  reminder_enabled: number;
  exam_length_minutes: number;
  problem_count: number;
}

const CoursesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editExamLength, setEditExamLength] = useState(120);

  const fetchCourses = async () => {
    try {
      const data = await select<Course>(`
        SELECT
          c.*,
          (SELECT COUNT(*) FROM problems p WHERE p.course_id = c.course_id) as problem_count
        FROM courses c
        ORDER BY c.course_id
      `);
      setCourses(data);
    } catch (err) {
      console.error('Failed to fetch courses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, []);

  const toggleTracking = async (e: React.MouseEvent, courseId: string, current: number) => {
    e.stopPropagation();
    await execute('UPDATE courses SET tracking_enabled = ? WHERE course_id = ?', [current ? 0 : 1, courseId]);
    await fetchCourses();
  };

  const toggleReminders = async (e: React.MouseEvent, courseId: string, current: number) => {
    e.stopPropagation();
    await execute('UPDATE courses SET reminder_enabled = ? WHERE course_id = ?', [current ? 0 : 1, courseId]);
    await fetchCourses();
  };

  const openSettings = (e: React.MouseEvent, course: Course) => {
    e.stopPropagation();
    if (expandedSettings === course.course_id) {
      setExpandedSettings(null);
    } else {
      setExpandedSettings(course.course_id);
      setEditTitle(course.title);
      setEditDescription(course.description || '');
      setEditExamLength(course.exam_length_minutes ?? 120);
    }
  };

  const handleSaveSettings = async (e: React.MouseEvent, courseId: string) => {
    e.stopPropagation();
    await execute('UPDATE courses SET title = ?, description = ?, exam_length_minutes = ? WHERE course_id = ?', [editTitle, editDescription || null, editExamLength, courseId]);
    setExpandedSettings(null);
    await fetchCourses();
  };

  const cancelSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSettings(null);
  };

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('common.courses')}</h1>
        <p className="text-muted-foreground mt-1">{t('courses.subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {courses.map((course) => (
          <div
            key={course.course_id}
            className="bg-card border rounded-lg shadow-sm overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => navigate(`/problems?course=${course.course_id}`)}
          >
            <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-primary/5 rounded-lg text-primary flex-shrink-0">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-xl font-bold">{course.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('courses.id_label')}: {course.course_id} &bull; {t('courses.problems_count', { count: course.problem_count })}
                  </p>
                  {course.description && (
                    <p className="text-sm text-muted-foreground">{course.description}</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <button
                  onClick={(e) => toggleTracking(e, course.course_id, course.tracking_enabled)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-all',
                    course.tracking_enabled
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                      : 'bg-muted border-transparent text-muted-foreground'
                  )}
                >
                  {course.tracking_enabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                  {course.tracking_enabled ? t('courses.tracking_on') : t('courses.tracking_off')}
                </button>

                <button
                  onClick={(e) => toggleReminders(e, course.course_id, course.reminder_enabled)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium transition-all',
                    course.reminder_enabled
                      ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400'
                      : 'bg-muted border-transparent text-muted-foreground'
                  )}
                >
                  {course.reminder_enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                  {course.reminder_enabled ? t('courses.reminders_on') : t('courses.reminders_off')}
                </button>

                <button
                  onClick={(e) => openSettings(e, course)}
                  className={cn(
                    'p-1.5 rounded-md border transition-all',
                    expandedSettings === course.course_id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-accent border-transparent'
                  )}
                  title={t('courses.course_settings')}
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {expandedSettings === course.course_id && (
              <div
                className="border-t px-5 py-4 bg-muted/30 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('courses.title_label')}</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-1.5 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('courses.description_label')}</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-1.5 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Exam Length (minutes)</label>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    value={editExamLength}
                    onChange={(e) => setEditExamLength(parseInt(e.target.value) || 120)}
                    className="w-full px-3 py-1.5 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-[11px] text-muted-foreground">Used as the time limit for Virtual Participation sessions</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => handleSaveSettings(e, course.course_id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90"
                  >
                    <Save className="w-3.5 h-3.5" /> {t('common.save')}
                  </button>
                  <button
                    onClick={cancelSettings}
                    className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent"
                  >
                    <X className="w-3.5 h-3.5" /> {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {courses.length === 0 && (
          <div className="p-12 text-center border-2 border-dashed rounded-lg text-muted-foreground">
            {t('courses.no_courses')}
          </div>
        )}
      </div>
    </div>
  );
};

export default CoursesPage;
