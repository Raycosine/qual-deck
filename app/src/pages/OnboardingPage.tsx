import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { execute, select } from '../lib/db';
import { isAppInitialized } from '../lib/tauri';

import { runImport, ImportSummary } from '../features/importer/importer';

const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    isAppInitialized().then((initialized) => {
      if (initialized) navigate('/dashboard', { replace: true });
    });
  }, [navigate]);
  const [path, setPath] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'validating' | 'importing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('onboarding.select_library'),
      });

      if (selected && typeof selected === 'string') {
        setPath(selected);
        setStatus('idle');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to open dialog');
      setStatus('error');
    }
  };

  const handleImport = async () => {
    if (!path) return;
    setStatus('importing');
    setError(null);
    try {
      // Upsert source library — safe to call on retry
      await execute(
        `INSERT OR IGNORE INTO source_libraries (name, root_path) VALUES (?, ?)`,
        ['Primary Library', path]
      );
      const libRows = await select<{ id: number }>(
        `SELECT id FROM source_libraries WHERE root_path = ? LIMIT 1`,
        [path]
      );
      const libraryId = libRows[0]?.id;
      if (!libraryId) throw new Error('Could not find or create source library record.');

      const result = await runImport(path, libraryId);
      setSummary(result);
      setStatus('success');
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Import failed. Check DevTools console for details.');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">{t('onboarding.welcome')}</h1>
          <p className="text-muted-foreground">{t('onboarding.select_desc')}</p>
        </div>

        <div className="bg-card border rounded-lg p-8 space-y-6 shadow-sm">
          {!path ? (
            <button
              onClick={handleSelectFolder}
              className="w-full flex flex-col items-center justify-center gap-4 py-12 border-2 border-dashed rounded-md hover:border-primary hover:bg-accent transition-all group"
            >
              <FolderOpen className="w-12 h-12 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="font-medium">{t('onboarding.select_library')}</span>
            </button>
          ) : (
            <div className="space-y-4 text-left">
              <div className="flex items-center gap-2 p-3 bg-accent rounded-md overflow-hidden">
                <FolderOpen className="w-5 h-5 flex-shrink-0 text-primary" />
                <span className="text-sm font-mono truncate">{path}</span>
              </div>
              
              {status === 'importing' ? (
                <div className="flex items-center justify-center gap-3 py-4">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span>{t('onboarding.importing')}</span>
                </div>
              ) : status === 'success' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-3 py-4 text-green-600">
                    <CheckCircle2 className="w-6 h-6" />
                    <span>{t('onboarding.import_success')}</span>
                  </div>
                  {summary && (
                    <div className="text-xs text-muted-foreground space-y-2 p-3 bg-accent rounded">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div>Exams: <span className="font-medium text-foreground">{summary.examsImported}</span></div>
                        <div>Problems: <span className="font-medium text-foreground">{summary.problemsImported}</span></div>
                        <div>JSON files: <span className="font-medium text-foreground">{summary.jsonFilesImported} / {summary.jsonFilesFound}</span></div>
                        <div>Solutions: <span className="font-medium text-foreground">{summary.solutionsMatched} / {summary.solutionsFound} matched</span></div>
                        <div>Topics: <span className="font-medium text-foreground">{summary.topicsImported}</span></div>
                      </div>
                      {summary.jsonFilesSkipped > 0 && (
                        <p className="text-yellow-600">Skipped {summary.jsonFilesSkipped} invalid JSON file{summary.jsonFilesSkipped > 1 ? 's' : ''}</p>
                      )}
                      {summary.unmatchedPdfs > 0 && (
                        <p className="text-yellow-600">{summary.unmatchedPdfs} PDF{summary.unmatchedPdfs > 1 ? 's' : ''} could not be linked to an exam</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleImport}
                  disabled={status === 'validating'}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 transition-opacity"
                >
                  {t('onboarding.get_started')}
                </button>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-2 text-destructive text-sm mt-4">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {status === 'success' && (
          <button
            onClick={() => navigate('/dashboard')}
            className="text-primary font-medium hover:underline"
          >
            {t('onboarding.get_started')} →
          </button>
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
