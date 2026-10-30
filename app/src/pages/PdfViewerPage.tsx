import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrowLeft, X, PlayCircle, FileText, BookOpen } from 'lucide-react';
import { select } from '../lib/db';
import AttemptPanel from '../features/reviews/AttemptPanel';
import PdfNotesPanel from '../features/notes/PdfNotesPanel';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExamPdf {
  id: number;
  kind: string;
  source_filename: string;
  absolute_path: string;
}

const PdfViewerPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialPath = searchParams.get('path');
  const pid = searchParams.get('pid');
  const courseId = searchParams.get('courseId') || '';
  const mode = searchParams.get('mode');
  const fromParam = searchParams.get('from');
  // Exam-level entry: the whole exam is being browsed, no single problem in focus.
  const examIdParam = searchParams.get('examId');
  const libraryIdParam = searchParams.get('libraryId');

  const [activeAbsPath, setActiveAbsPath] = useState<string | null>(initialPath);
  const [activeUrl, setActiveUrl] = useState<string | null>(
    initialPath ? convertFileSrc(initialPath) : null
  );
  const [examPdfs, setExamPdfs] = useState<ExamPdf[]>([]);
  const [showAttempt, setShowAttempt] = useState(mode === 'attempt');
  const [examCtx, setExamCtx] = useState<{ examId: string | null; libraryId: number | null }>({
    examId: examIdParam,
    libraryId: libraryIdParam ? Number(libraryIdParam) : null,
  });

  const normPath = (p: string) => p.replace(/\\/g, '/');
  const exitViewer = () => {
    if (fromParam) navigate(decodeURIComponent(fromParam));
    else navigate(-1);
  };

  useEffect(() => {
    if (examIdParam) {
      select<ExamPdf>(`
        SELECT id, kind, source_filename, absolute_path
        FROM pdf_files
        WHERE exam_id = ? AND (? IS NULL OR source_library_id = ?)
        ORDER BY kind, source_filename
      `, [examIdParam, examCtx.libraryId, examCtx.libraryId]).then(setExamPdfs).catch(console.error);
      return;
    }
    if (!pid || !courseId) return;
    select<ExamPdf>(`
      SELECT pf.id, pf.kind, pf.source_filename, pf.absolute_path
      FROM pdf_files pf
      JOIN problems p ON pf.exam_id = p.exam_id
      WHERE p.pid = ? AND p.course_id = ?
        AND (p.source_library_id IS NULL OR pf.source_library_id = p.source_library_id)
      ORDER BY pf.kind, pf.source_filename
    `, [pid, courseId]).then(setExamPdfs).catch(console.error);
  }, [pid, courseId, examIdParam, examCtx.libraryId]);

  // Resolve which exam a single problem belongs to, for the notes panel.
  useEffect(() => {
    if (examIdParam || !pid || !courseId) return;
    select<{ exam_id: string; source_library_id: number | null }>(
      `SELECT exam_id, source_library_id FROM problems WHERE pid = ? AND course_id = ?`,
      [pid, courseId]
    ).then(rows => {
      if (rows[0]) setExamCtx({ examId: rows[0].exam_id, libraryId: rows[0].source_library_id });
    }).catch(console.error);
  }, [pid, courseId, examIdParam]);

  const switchPdf = (path: string) => {
    setActiveAbsPath(path);
    setActiveUrl(convertFileSrc(path));
  };

  if (!initialPath || !activeUrl) {
    return <div className="p-8 text-center text-destructive">Invalid PDF path.</div>;
  }

  const questions = examPdfs.filter((p) => p.kind === 'question');
  const solutions = examPdfs.filter((p) => p.kind === 'solution');
  const firstName = activeAbsPath?.split(/[\\/]/).pop() ?? '';
  const activeKind: 'problem' | 'solution' =
    solutions.some(sol => normPath(sol.absolute_path) === normPath(activeAbsPath ?? ''))
      ? 'solution'
      : 'problem';

  return (
    <div className="flex h-screen bg-muted/30 overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2 bg-background border-b z-10 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-accent rounded-full transition-colors flex-shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-bold truncate max-w-xs">{firstName}</h1>
              {!pid && examCtx.examId && (
                <span className="text-[10px] font-mono text-muted-foreground uppercase">
                  {examCtx.examId} · whole exam
                </span>
              )}
              {pid && (
                <div className="flex items-center gap-1.5">
                  {courseId && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {courseId}
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground uppercase">{pid}</span>
                </div>
              )}
            </div>
          </div>

          {/* PDF switcher */}
          {(questions.length > 0 || solutions.length > 0) && (
            <div className="flex items-center gap-1 bg-muted p-0.5 rounded-md flex-shrink-0">
              {questions.length > 0 && (
                <button
                  onClick={() => switchPdf(questions[0].absolute_path)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-all',
                    normPath(activeAbsPath ?? '') === normPath(questions[0].absolute_path)
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title={questions[0].source_filename}
                >
                  <FileText className="w-3.5 h-3.5" /> Problem
                </button>
              )}
              {solutions.map((sol, idx) => (
                <button
                  key={sol.id}
                  onClick={() => switchPdf(sol.absolute_path)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-all',
                    normPath(activeAbsPath ?? '') === normPath(sol.absolute_path)
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title={sol.source_filename}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  {solutions.length > 1 ? `Solution ${idx + 1}` : 'Solution'}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
            {!showAttempt && pid && (
              <button
                onClick={() => setShowAttempt(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded hover:opacity-90"
              >
                <PlayCircle className="w-4 h-4" /> Start Attempt
              </button>
            )}
            <button
              onClick={exitViewer}
              className="p-2 hover:bg-accent rounded-md transition-colors"
              title="Close viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* PDF content */}
        <div className="flex-1 overflow-hidden relative">
          <iframe
            src={`${activeUrl}#toolbar=1&navpanes=0&scrollbar=1`}
            className="w-full h-full border-none"
            title="PDF Viewer"
          />
          <PdfNotesPanel
            examId={examCtx.examId}
            libraryId={examCtx.libraryId}
            kind={activeKind}
            focusPid={pid}
            focusCourseId={courseId}
            expandAll={!pid}
          />
        </div>
      </div>

      {showAttempt && pid && (
        <AttemptPanel
          pid={pid}
          courseId={courseId}
          onClose={() => setShowAttempt(false)}
          onSave={() => navigate(`/problems/${courseId}/${pid}`, {
            state: { from: fromParam ? decodeURIComponent(fromParam) : '/problems' },
          })}
        />
      )}
    </div>
  );
};

export default PdfViewerPage;
