import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { select } from '../lib/db';
import {
  Calendar,
  AlertCircle,
  PlayCircle,
  Eye,
  ChevronDown,
  HelpCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DueProblem {
  pid: string;
  course_id: string;
  next_review_at: string;
  current_mastery: number;
  problem_number: number;
}

const ReviewsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dueProblems, setDueProblems] = useState<DueProblem[]>([]);
  const [loading, setLoading] = useState(true);
  const [helpExpanded, setHelpExpanded] = useState(false);

  useEffect(() => {
    const fetchDue = async () => {
      try {
        const now = new Date().toISOString();
        const data = await select<DueProblem>(`
          SELECT 
            p.pid, p.course_id, p.problem_number,
            ps.next_review_at, ps.current_mastery
          FROM problems p
          JOIN problem_state ps ON p.pid = ps.pid AND p.course_id = ps.course_id
          WHERE ps.next_review_at <= ?
          ORDER BY ps.next_review_at ASC
        `, [now]);
        setDueProblems(data);
      } catch (err) {
        console.error('Failed to fetch due problems:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDue();
  }, []);

  if (loading) return <div className="p-8 text-center">{t('common.loading')}</div>;

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('common.reviews')}</h1>
        <p className="text-muted-foreground mt-1">Mastery is built through consistent review.</p>
      </header>

      {/* FSRS help section */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <button
          onClick={() => setHelpExpanded(e => !e)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">How reviews work</span>
          </div>
          <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', helpExpanded && 'rotate-180')} />
        </button>
        {helpExpanded && (
          <div className="px-4 pb-4 pt-2 border-t space-y-3 text-sm text-muted-foreground">
            <p>
              QualDeck uses <strong className="text-foreground">FSRS v4</strong> (Free Spaced Repetition Scheduler) to schedule your problem reviews.
              The goal is to show each problem just before you would forget it, building long-term retention with minimal repetition.
            </p>
            <div className="space-y-1.5">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wider">Mastery levels (1–4)</p>
              <ul className="space-y-1 text-xs pl-3">
                <li><span className="font-mono font-bold">1</span> — Seen / barely recall. Needed to read the solution.</li>
                <li><span className="font-mono font-bold">2</span> — Partial recall. Solved with hints or minor detours.</li>
                <li><span className="font-mono font-bold">3</span> — Solid recall. Solved independently with small mistakes.</li>
                <li><span className="font-mono font-bold">4</span> — Full mastery. Clean, confident solution.</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wider">FSRS concepts</p>
              <ul className="space-y-1 text-xs pl-3">
                <li><strong className="text-foreground">Stability</strong> — how many days until your recall drops to 90%. Grows each successful review.</li>
                <li><strong className="text-foreground">Difficulty</strong> — how hard the scheduler thinks this problem is for you, adjusted over time.</li>
                <li><strong className="text-foreground">Interval</strong> — days until the next scheduled review, derived from stability.</li>
              </ul>
            </div>
            <p className="text-xs">
              A higher mastery grade pushes the next review further out. Giving up or rating mastery 1 resets the interval and reschedules soon.
              The scheduler targets <strong className="text-foreground">90% retention</strong>: you should be able to recall ~9 out of 10 problems when they come due.
            </p>
          </div>
        )}
      </div>

      {dueProblems.length === 0 ? (
        <div className="bg-card border rounded-lg p-12 text-center space-y-4 shadow-sm">
          <div className="flex justify-center">
            <div className="p-4 bg-primary/10 rounded-full">
              <Calendar className="w-12 h-12 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">All caught up!</h2>
            <p className="text-muted-foreground">No problems are due for review right now. Great job!</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <AlertCircle className="w-4 h-4" />
            {dueProblems.length} problems due for review
          </div>
          
          <div className="grid grid-cols-1 gap-3">
            {dueProblems.map((problem) => (
              <div 
                key={problem.pid}
                className="bg-card border rounded-lg p-4 hover:shadow-md transition-all group flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary/5 rounded flex items-center justify-center font-bold text-primary">
                    {problem.current_mastery}
                  </div>
                  <div>
                    <h3 className="font-mono font-bold">{problem.pid}</h3>
                    <p className="text-xs text-muted-foreground uppercase">
                      Course {problem.course_id} • Due {new Date(problem.next_review_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/problems/${problem.course_id}/${problem.pid}`, { state: { from: '/reviews' } })}
                    className="p-2 hover:bg-accent rounded-md text-muted-foreground hover:text-foreground"
                    title="View"
                  >
                    <Eye className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => navigate(`/problems/${problem.course_id}/${problem.pid}`, { state: { from: '/reviews' } })}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-bold hover:opacity-90"
                  >
                    <PlayCircle className="w-4 h-4" /> Review Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewsPage;
