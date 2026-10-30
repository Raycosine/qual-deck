import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Save, X, PlayCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AttemptMode, Outcome, PathQuality, scheduleFSRS } from './scheduler';
import { execute, select } from '../../lib/db';
import { useTranslation } from 'react-i18next';
import { exportDailyMarkdown } from '../export/markdownExport';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface AttemptPanelProps {
  pid: string;
  courseId: string;
  onClose: () => void;
  onSave: () => void;
}

const AttemptPanel: React.FC<AttemptPanelProps> = ({ pid, courseId, onClose, onSave }) => {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [mode, setMode] = useState<AttemptMode>('blind_solved');
  const [outcome, setOutcome] = useState<Outcome>('correct');
  const [mastery, setMastery] = useState(3);
  const [quality, setQuality] = useState<PathQuality>('reasonable');
  const [notes, setNotes] = useState('');
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isActive && !isFinished) {
      interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isActive, isFinished]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSave = async () => {
    try {
      // Fetch current FSRS state to feed into the scheduler
      const stateRows = await select<{
        stability: number;
        difficulty: number;
        last_attempt_at: string | null;
      }>(
        `SELECT stability, difficulty, last_attempt_at FROM problem_state WHERE pid = ? AND course_id = ?`,
        [pid, courseId],
      );

      const currentState = stateRows.length > 0 && stateRows[0].stability > 0
        ? { stability: stateRows[0].stability, difficulty: stateRows[0].difficulty }
        : null;
      const lastAttemptAt = stateRows[0]?.last_attempt_at ?? null;

      const { nextReview, state } = scheduleFSRS(
        { mastery, outcome, attemptMode: mode, pathQuality: quality },
        lastAttemptAt,
        currentState,
      );

      await execute(`
        INSERT INTO attempts (pid, course_id, duration_seconds, attempt_mode, outcome, mastery, path_quality, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [pid, courseId, seconds, mode, outcome, mastery, quality, notes]);

      await execute(`
        INSERT INTO problem_state (
          pid, course_id, current_mastery, stability, difficulty,
          last_attempt_at, next_review_at,
          total_attempts, total_duration_seconds, last_outcome, last_attempt_mode
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
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
      `, [pid, courseId, mastery, state.stability, state.difficulty, nextReview.toISOString(), seconds, outcome, mode]);

      onSave();
      select<{ value: string }>(`SELECT value FROM settings WHERE key = 'export_auto_enabled'`)
        .then(rows => { if (rows[0]?.value === 'true') exportDailyMarkdown().catch(console.error); })
        .catch(console.error);
    } catch (err) {
      console.error('Failed to save attempt:', err);
    }
  };

  return (
    <div className="w-80 border-l bg-card flex flex-col h-full shadow-2xl z-20">
      <header className="p-4 border-b flex justify-between items-center bg-muted/30">
        <h2 className="font-bold flex items-center gap-2">
          <PlayCircle className="w-4 h-4 text-primary" /> Attempt Tracking
        </h2>
        <button onClick={onClose} className="p-1 hover:bg-accent rounded-md">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Timer */}
        <div className="bg-background border rounded-lg p-6 text-center space-y-4 shadow-sm">
          <div className="text-4xl font-mono font-bold tracking-tight">{formatTime(seconds)}</div>
          {!isFinished && (
            <div className="flex justify-center gap-2">
              <button onClick={() => setIsActive(!isActive)} className="p-2 border rounded-full hover:bg-accent">
                {isActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={() => { setIsFinished(true); setIsActive(false); }}
                className="p-2 bg-destructive text-destructive-foreground rounded-full hover:opacity-90"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>
            </div>
          )}
        </div>

        {isFinished && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as AttemptMode)}
                className="w-full p-2 border rounded bg-background text-sm"
              >
                <option value="blind_solved">Blind Solved</option>
                <option value="detour_solved">Detour Solved</option>
                <option value="smooth_solved">Smooth Solved</option>
                <option value="read_solution_only">Read Solution Only</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Outcome</label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as Outcome)}
                className="w-full p-2 border rounded bg-background text-sm"
              >
                <option value="correct">Correct</option>
                <option value="mostly_correct">Mostly Correct</option>
                <option value="partial">Partial</option>
                <option value="gave_up">Gave Up</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Mastery (0–4)</label>
              <div className="flex justify-between gap-1">
                {[0, 1, 2, 3, 4].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMastery(m)}
                    className={cn(
                      'flex-1 py-1 text-sm border rounded transition-colors',
                      mastery === m ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Path Quality</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as PathQuality)}
                className="w-full p-2 border rounded bg-background text-sm"
              >
                <option value="clean">Clean</option>
                <option value="reasonable">Reasonable</option>
                <option value="detour">Detour</option>
                <option value="messy">Messy</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 border rounded bg-background text-sm min-h-[100px] resize-none"
                placeholder="Add your study notes..."
              />
            </div>
          </div>
        )}
      </div>

      <footer className="p-4 border-t bg-muted/30">
        <button
          disabled={!isFinished}
          onClick={handleSave}
          className="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> {t('common.save')}
        </button>
      </footer>
    </div>
  );
};

export default AttemptPanel;
