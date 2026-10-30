import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { select, execute } from '../lib/db';
import { useApp } from '../app/providers';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FolderOpen,
  RefreshCw,
  Sun,
  Languages,
  FileWarning,
  Database,
  Bell,
  BellOff,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Check,
  X,
  FolderInput,
  FileDown,
  Download,
  Upload,
  HardDrive,
  Wrench,
  StickyNote,
} from 'lucide-react';
import { runImport, ImportSummary } from '../features/importer/importer';
import { exportDailyMarkdown, moveExportFiles, getExportFolder } from '../features/export/markdownExport';
import {
  exportAllRecords,
  importAllRecords,
  getDataFolder,
  ImportSummary as RecordsImportSummary,
} from '../features/backup/recordsBackup';
import { repairNotes, NotesDiagnostics } from '../features/notes/notesMaintenance';
import { ensureIndexes, IndexDiagnostics } from '../features/maintenance/dbIndexes';
import { openPath } from '@tauri-apps/plugin-opener';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Library {
  id: number;
  name: string;
  root_path: string;
  last_scanned_at: string | null;
}

interface UnmatchedPdf {
  id: number;
  source_filename: string;
  absolute_path: string;
  kind: string;
}

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, setTheme, language, setLanguage } = useApp();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [status, setStatus] = useState<Record<number, 'idle' | 'importing' | 'success'>>({});
  const [summaries, setSummaries] = useState<Record<number, ImportSummary>>({});

  // Per-library inline rename state
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Notifications
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifTime, setNotifTime] = useState('09:00');

  // Unmatched PDFs
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [unmatchedPdfs, setUnmatchedPdfs] = useState<UnmatchedPdf[]>([]);

  // Per-library delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Clear all data
  const [confirmClear, setConfirmClear] = useState(false);

  // Export settings
  const [exportFolder, setExportFolder] = useState('');
  const [autoExport, setAutoExport] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');

  // Full records backup / restore
  const [dataFolder, setDataFolder] = useState('');
  const [recordsBusy, setRecordsBusy] = useState<'idle' | 'exporting' | 'importing'>('idle');
  const [recordsMessage, setRecordsMessage] = useState<string | null>(null);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<RecordsImportSummary | null>(null);

  // Notes compatibility check
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesDiag, setNotesDiag] = useState<NotesDiagnostics | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Database index check
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexDiag, setIndexDiag] = useState<IndexDiagnostics | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const fetchLibraries = async () => {
    const libData = await select<Library>('SELECT * FROM source_libraries ORDER BY id');
    setLibraries(libData);
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        await fetchLibraries();

        const notifRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'notifications_enabled'`
        );
        setNotifEnabled(notifRows[0]?.value === 'true');

        const timeRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'notification_time'`
        );
        setNotifTime(timeRows[0]?.value || '09:00');

        const folderRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'export_folder'`
        );
        const folder = folderRows[0]?.value || await getExportFolder();
        setExportFolder(folder);

        const autoRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'export_auto_enabled'`
        );
        setAutoExport(autoRows[0]?.value === 'true');

        setDataFolder(await getDataFolder());
      } catch (err) {
        console.error('Failed to fetch settings:', err);
      }
    };
    fetchSettings();
  }, []);

  const handleRescan = async (lib: Library) => {
    setStatus((s) => ({ ...s, [lib.id]: 'importing' }));
    try {
      const result = await runImport(lib.root_path, lib.id);
      await execute(
        'UPDATE source_libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?',
        [lib.id]
      );
      setSummaries((s) => ({ ...s, [lib.id]: result }));
      setStatus((s) => ({ ...s, [lib.id]: 'success' }));
      await fetchLibraries();
    } catch (err) {
      console.error('Rescan failed:', err);
      setStatus((s) => ({ ...s, [lib.id]: 'idle' }));
    }
  };

  const startRename = (lib: Library) => {
    setRenamingId(lib.id);
    setRenameValue(lib.name);
  };

  const confirmRename = async (libId: number) => {
    if (!renameValue.trim()) return;
    await execute('UPDATE source_libraries SET name = ? WHERE id = ?', [renameValue.trim(), libId]);
    setRenamingId(null);
    await fetchLibraries();
  };

  const handleChangePath = async (lib: Library) => {
    const selected = await open({ directory: true, multiple: false, title: 'Select new library folder' });
    if (!selected || typeof selected !== 'string') return;
    await execute('UPDATE source_libraries SET root_path = ? WHERE id = ?', [selected, lib.id]);
    await fetchLibraries();
  };

  const handleToggleNotif = async (enabled: boolean) => {
    setNotifEnabled(enabled);
    await execute(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('notifications_enabled', ?)`,
      [enabled ? 'true' : 'false']
    );
  };

  const handleNotifTimeChange = async (time: string) => {
    setNotifTime(time);
    await execute(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('notification_time', ?)`,
      [time]
    );
  };

  const handleShowUnmatched = async () => {
    if (!showUnmatched) {
      try {
        const pdfs = await select<UnmatchedPdf>(
          `SELECT id, source_filename, absolute_path, kind FROM pdf_files WHERE exam_id IS NULL ORDER BY source_filename`
        );
        setUnmatchedPdfs(pdfs);
      } catch (err) {
        console.error('Failed to fetch unmatched PDFs:', err);
      }
    }
    setShowUnmatched(!showUnmatched);
  };

  const handleAddLibrary = async () => {
    const selected = await open({ directory: true, multiple: false, title: t('settings.add_library') });
    if (!selected || typeof selected !== 'string') return;

    const name = `Library ${libraries.length + 1}`;
    await execute(`INSERT OR IGNORE INTO source_libraries (name, root_path) VALUES (?, ?)`, [name, selected]);
    const libRows = await select<{ id: number }>(`SELECT id FROM source_libraries WHERE root_path = ? LIMIT 1`, [selected]);
    const libraryId = libRows[0]?.id;
    if (!libraryId) return;

    setStatus((s) => ({ ...s, [libraryId]: 'importing' }));
    await fetchLibraries();
    try {
      const result = await runImport(selected, libraryId);
      await execute('UPDATE source_libraries SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?', [libraryId]);
      setSummaries((s) => ({ ...s, [libraryId]: result }));
      setStatus((s) => ({ ...s, [libraryId]: 'success' }));
      await fetchLibraries();
    } catch (err) {
      console.error('Import failed:', err);
      setStatus((s) => ({ ...s, [libraryId]: 'idle' }));
    }
  };

  const handleDeleteLibrary = async (libId: number) => {
    await execute(`
      DELETE FROM attempts WHERE (pid, course_id) IN
        (SELECT pid, course_id FROM problems WHERE source_library_id = ?)`, [libId]);
    await execute(`
      DELETE FROM problem_state WHERE (pid, course_id) IN
        (SELECT pid, course_id FROM problems WHERE source_library_id = ?)`, [libId]);
    await execute(`
      DELETE FROM problem_pdf_links WHERE pid IN
        (SELECT pid FROM problems WHERE source_library_id = ?)`, [libId]);
    await execute(`
      DELETE FROM problem_topics WHERE (pid, course_id) IN
        (SELECT pid, course_id FROM problems WHERE source_library_id = ?)`, [libId]);
    await execute(`DELETE FROM problems WHERE source_library_id = ?`, [libId]);
    await execute(`DELETE FROM pdf_files WHERE source_library_id = ?`, [libId]);
    await execute(`DELETE FROM exams WHERE source_library_id = ?`, [libId]);
    await execute(`DELETE FROM source_libraries WHERE id = ?`, [libId]);
    setConfirmDeleteId(null);
    await fetchLibraries();
  };

  const handleChangeExportFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Select export folder' });
    if (!selected || typeof selected !== 'string') return;
    await moveExportFiles(exportFolder, selected);
    await execute(`INSERT OR REPLACE INTO settings (key, value) VALUES ('export_folder', ?)`, [selected]);
    setExportFolder(selected);
  };

  const handleToggleAutoExport = async (enabled: boolean) => {
    setAutoExport(enabled);
    await execute(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('export_auto_enabled', ?)`,
      [enabled ? 'true' : 'false']
    );
  };

  const handleExportNow = async () => {
    setExportStatus('exporting');
    try {
      await exportDailyMarkdown();
      setExportStatus('done');
      setTimeout(() => setExportStatus('idle'), 2500);
    } catch (err) {
      console.error('Export failed:', err);
      setExportStatus('idle');
    }
  };

  const handleExportAllRecords = async () => {
    setRecordsBusy('exporting');
    setRecordsError(null);
    setImportSummary(null);
    try {
      const path = await exportAllRecords();
      setRecordsMessage(path ? `Records exported to ${path}` : null);
    } catch (err) {
      console.error('Records export failed:', err);
      setRecordsError(String(err));
    } finally {
      setRecordsBusy('idle');
    }
  };

  const handleImportRecords = async () => {
    setRecordsBusy('importing');
    setRecordsError(null);
    setRecordsMessage(null);
    try {
      const summary = await importAllRecords();
      setImportSummary(summary);
    } catch (err) {
      console.error('Records import failed:', err);
      setRecordsError(String(err));
    } finally {
      setRecordsBusy('idle');
    }
  };

  const handleRepairNotes = async () => {
    setNotesBusy(true);
    setNotesError(null);
    try {
      setNotesDiag(await repairNotes());
    } catch (err) {
      console.error('Notes repair failed:', err);
      setNotesError(String(err));
    } finally {
      setNotesBusy(false);
    }
  };

  const handleEnsureIndexes = async () => {
    setIndexBusy(true);
    setIndexError(null);
    try {
      setIndexDiag(await ensureIndexes());
    } catch (err) {
      console.error('Index check failed:', err);
      setIndexError(String(err));
    } finally {
      setIndexBusy(false);
    }
  };

  const handleClearAllData = async () => {
    const tables = [
      'attempts', 'problem_state', 'problem_pdf_links', 'problem_topics',
      'pdf_files', 'problems', 'exams', 'topic_nodes', 'courses',
      'source_libraries', 'settings',
    ];
    for (const table of tables) {
      await execute(`DELETE FROM ${table}`);
    }
    navigate('/onboarding', { replace: true });
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto pb-20">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('common.settings')}</h1>
        <p className="text-muted-foreground mt-1">{t('settings.subtitle')}</p>
      </header>

      {/* Appearance */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sun className="w-4 h-4" /> {t('settings.appearance')}
        </h2>
        <div className="bg-card border rounded-lg divide-y shadow-sm">
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.theme')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.theme_desc')}</p>
            </div>
            <div className="flex bg-muted p-1 rounded-md">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded transition-all capitalize',
                    theme === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.language')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.language_desc')}</p>
            </div>
            <button
              onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
              className="flex items-center gap-2 px-3 py-1.5 border rounded-md hover:bg-accent transition-colors"
            >
              <Languages className="w-4 h-4" />
              <span className="text-sm font-bold uppercase">{language}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Bell className="w-4 h-4" /> {t('settings.notifications')}
        </h2>
        <div className="bg-card border rounded-lg divide-y shadow-sm">
          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{t('settings.notif_enable')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.notif_enable_desc')}</p>
            </div>
            <button
              onClick={() => handleToggleNotif(!notifEnabled)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                notifEnabled ? 'bg-primary' : 'bg-muted'
              )}
              aria-checked={notifEnabled}
              role="switch"
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow',
                  notifEnabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
          {notifEnabled ? (
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{t('settings.notif_time')}</p>
                <p className="text-xs text-muted-foreground">{t('settings.notif_time_desc')}</p>
              </div>
              <input
                type="time"
                value={notifTime}
                onChange={(e) => handleNotifTimeChange(e.target.value)}
                className="px-3 py-1.5 border rounded-md bg-background text-sm"
              />
            </div>
          ) : (
            <div className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
              <BellOff className="w-4 h-4" />
              {t('settings.notif_off')}
            </div>
          )}
        </div>
      </section>

      {/* Export */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <FileDown className="w-4 h-4" /> Export &amp; Backup
        </h2>
        <div className="bg-card border rounded-lg divide-y shadow-sm">
          <div className="p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm">Export Folder</p>
              <p className="text-xs font-mono text-muted-foreground truncate max-w-xs mt-0.5">
                {exportFolder || 'Loading…'}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {exportFolder && (
                <button
                  onClick={() => openPath(exportFolder)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
                  title="Open in file explorer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleChangeExportFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" /> Change
              </button>
            </div>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto-export daily record</p>
              <p className="text-xs text-muted-foreground">Create/update today's markdown when you study</p>
            </div>
            <button
              onClick={() => handleToggleAutoExport(!autoExport)}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                autoExport ? 'bg-primary' : 'bg-muted'
              )}
              aria-checked={autoExport}
              role="switch"
            >
              <span className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow',
                autoExport ? 'translate-x-6' : 'translate-x-1'
              )} />
            </button>
          </div>

          <div className="p-4">
            <button
              onClick={handleExportNow}
              disabled={exportStatus === 'exporting'}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                exportStatus === 'done'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50'
              )}
            >
              <Download className="w-4 h-4" />
              {exportStatus === 'exporting' ? 'Exporting…' : exportStatus === 'done' ? 'Exported!' : "Export Today's Record"}
            </button>
          </div>

          {/* Data folder */}
          <div className="p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" /> Data Folder
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Where the QualDeck database lives
              </p>
              <p className="text-xs font-mono text-muted-foreground truncate max-w-xs mt-0.5">
                {dataFolder || 'Loading...'}
              </p>
            </div>
            {dataFolder && (
              <button
                onClick={() => openPath(dataFolder)}
                className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors flex-shrink-0"
                title="Open in file explorer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Full records backup / restore */}
          <div className="p-4 space-y-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">All Progress &amp; Records</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Export every attempt, mastery state, virtual exam session and custom list into one
                JSON file, and merge such a file back in. Importing never touches your source
                libraries or problems: records for libraries, courses or problems this install does
                not have are skipped, and records you already have are not duplicated.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleExportAllRecords}
                disabled={recordsBusy !== 'idle'}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                {recordsBusy === 'exporting' ? 'Exporting...' : 'Export All Records'}
              </button>
              <button
                onClick={handleImportRecords}
                disabled={recordsBusy !== 'idle'}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border hover:bg-accent disabled:opacity-50 transition-colors"
              >
                <Upload className="w-4 h-4" />
                {recordsBusy === 'importing' ? 'Importing...' : 'Import Records From...'}
              </button>
            </div>

            {recordsMessage && (
              <p className="text-xs text-green-700 dark:text-green-400 font-mono break-all">{recordsMessage}</p>
            )}
            {recordsError && (
              <p className="text-xs text-red-600 dark:text-red-400 break-all">{recordsError}</p>
            )}
            {importSummary && (
              <div className="text-xs bg-muted/50 border rounded-md p-3 space-y-1">
                <p className="font-medium">Import finished</p>
                <p className="text-muted-foreground">
                  Attempts: {importSummary.attempts_imported} imported, {importSummary.attempts_skipped} already present
                </p>
                <p className="text-muted-foreground">
                  Mastery state: {importSummary.states_imported} added, {importSummary.states_updated} updated
                </p>
                <p className="text-muted-foreground">
                  Exam sessions: {importSummary.sessions_imported} imported, {importSummary.sessions_skipped} already present
                </p>
                <p className="text-muted-foreground">
                  Lists: {importSummary.lists_created} created, {importSummary.list_items_imported} items added
                </p>
                <p className="text-muted-foreground">
                  Notes: {importSummary.notes_imported} imported, {importSummary.notes_updated} updated
                </p>
                {importSummary.unknown_problems > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    {importSummary.unknown_problems} records skipped: problem not in this install
                  </p>
                )}
                {importSummary.unknown_libraries.length > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    Missing source libraries: {importSummary.unknown_libraries.join(', ')}
                  </p>
                )}
                {importSummary.unknown_courses.length > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    Missing courses: {importSummary.unknown_courses.join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Debug / maintenance */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Wrench className="w-4 h-4" /> Debug
        </h2>
        <div className="bg-card border rounded-lg shadow-sm p-4 space-y-3">
          <div className="min-w-0">
            <p className="font-medium text-sm flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5" /> Check &amp; Repair Notes Data
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verifies the problem/solution notes table exists and, for databases created before
              notes were added, inserts a blank note for every problem and for every problem whose
              exam has a solution PDF. Existing notes are never touched.
            </p>
          </div>
          <button
            onClick={handleRepairNotes}
            disabled={notesBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <Wrench className="w-4 h-4" />
            {notesBusy ? 'Checking...' : 'Check & Repair Notes'}
          </button>

          {notesError && (
            <p className="text-xs text-red-600 dark:text-red-400 break-all">{notesError}</p>
          )}
          {notesDiag && (
            <div className="text-xs bg-muted/50 border rounded-md p-3 space-y-1">
              <p className="font-medium">
                {notesDiag.tableCreated ? 'Notes table was missing and has been created' : 'Notes table present'}
              </p>
              <p className="text-muted-foreground">
                Problems: {notesDiag.problems} · with solution PDF: {notesDiag.problemsWithSolution}
              </p>
              <p className="text-muted-foreground">
                Existing note rows before: {notesDiag.problemNotesBefore} problem / {notesDiag.solutionNotesBefore} solution
              </p>
              <p className="text-muted-foreground">
                Blank rows added: {notesDiag.problemNotesCreated} problem / {notesDiag.solutionNotesCreated} solution
              </p>
              <p className="text-muted-foreground">
                Notes containing text: {notesDiag.notesWithText}
              </p>
            </div>
          )}
        </div>

        <div className="bg-card border rounded-lg shadow-sm p-4 space-y-3">
          <div className="min-w-0">
            <p className="font-medium text-sm flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" /> Check &amp; Rebuild Indexes
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Creates the database indexes the problem list depends on. Without them the list query
              scans every topic and PDF row per problem, which is what made loading and filtering
              slow on large libraries.
            </p>
          </div>
          <button
            onClick={handleEnsureIndexes}
            disabled={indexBusy}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <Database className="w-4 h-4" />
            {indexBusy ? 'Checking...' : 'Check & Rebuild Indexes'}
          </button>

          {indexError && (
            <p className="text-xs text-red-600 dark:text-red-400 break-all">{indexError}</p>
          )}
          {indexDiag && (
            <div className="text-xs bg-muted/50 border rounded-md p-3 space-y-1">
              <p className="font-medium">
                {indexDiag.created.length === 0
                  ? 'All indexes already present'
                  : `${indexDiag.created.length} index(es) created`}
              </p>
              <p className="text-muted-foreground">
                {indexDiag.presentBefore}/{indexDiag.expected} present before · took {indexDiag.elapsedMs}ms
              </p>
              {indexDiag.created.length > 0 && (
                <p className="text-muted-foreground font-mono break-all">{indexDiag.created.join(', ')}</p>
              )}
              {indexDiag.failed.length > 0 && (
                <p className="text-amber-600 dark:text-amber-400 font-mono break-all">
                  Failed: {indexDiag.failed.join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Data Management */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Database className="w-4 h-4" /> {t('settings.data')}
        </h2>
        <div className="space-y-3">
          {libraries.map((lib) => {
            const libStatus = status[lib.id] ?? 'idle';
            const libSummary = summaries[lib.id];
            return (
              <div key={lib.id} className="bg-card border rounded-lg p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="p-2 bg-primary/5 rounded text-primary flex-shrink-0 mt-0.5">
                      <FolderOpen className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      {renamingId === lib.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmRename(lib.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            autoFocus
                            className="px-2 py-1 border rounded-md bg-background text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                          <button
                            onClick={() => confirmRename(lib.id)}
                            className="p-1 hover:bg-accent rounded"
                          >
                            <Check className="w-4 h-4 text-green-600" />
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="p-1 hover:bg-accent rounded"
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-lg truncate">{lib.name}</p>
                          <button
                            onClick={() => startRename(lib)}
                            className="p-1 hover:bg-accent rounded opacity-50 hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                            title={t('settings.rename')}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <p className="text-xs font-mono text-muted-foreground truncate max-w-xs mt-0.5">
                        {lib.root_path}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleChangePath(lib)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
                      title={t('settings.change_path')}
                    >
                      <FolderInput className="w-3.5 h-3.5" />
                      {t('settings.change_path')}
                    </button>
                    <button
                      onClick={() => handleRescan(lib)}
                      disabled={libStatus === 'importing'}
                      className="flex items-center gap-2 px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-bold hover:opacity-90 disabled:opacity-50"
                    >
                      <RefreshCw className={cn('w-3.5 h-3.5', libStatus === 'importing' && 'animate-spin')} />
                      {libStatus === 'importing' ? t('settings.rescanning') : t('settings.rescan')}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(lib.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-destructive/30 text-destructive rounded-md text-xs font-medium hover:bg-destructive/5 transition-colors"
                      title="Delete library"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {lib.last_scanned_at && (
                  <p className="text-[10px] text-muted-foreground">
                    {t('settings.last_scanned')}: {new Date(lib.last_scanned_at).toLocaleString()}
                  </p>
                )}

                {confirmDeleteId === lib.id && (
                  <div className="p-3 bg-destructive/5 border border-destructive/20 rounded space-y-2">
                    <p className="text-sm font-medium text-destructive">Delete "{lib.name}"? This will remove all its problems and study data.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteLibrary(lib.id)}
                        className="px-4 py-1.5 bg-destructive text-destructive-foreground rounded text-xs font-bold hover:opacity-90"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-4 py-1.5 border rounded text-xs font-medium hover:bg-accent"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {libStatus === 'success' && libSummary && (
                  <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 rounded text-xs text-green-800 dark:text-green-300 space-y-2">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <span className="font-bold block">Exams</span>
                        {libSummary.examsImported} imported
                      </div>
                      <div>
                        <span className="font-bold block">Problems</span>
                        {libSummary.problemsImported} imported
                      </div>
                      <div>
                        <span className="font-bold block">Solutions</span>
                        {libSummary.solutionsMatched} / {libSummary.solutionsFound} matched
                      </div>
                      <div>
                        <span className="font-bold block">Topics</span>
                        {libSummary.topicsImported} imported
                      </div>
                    </div>
                    {libSummary.unmatchedPdfs > 0 && (
                      <p className="text-yellow-700 dark:text-yellow-400">
                        {libSummary.unmatchedPdfs} PDF{libSummary.unmatchedPdfs > 1 ? 's' : ''} could not be linked to an exam (check Advanced → Unmatched PDFs)
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={handleAddLibrary} className="w-full py-3 border-2 border-dashed rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:border-primary transition-all">
            {t('settings.add_library')}
          </button>
        </div>
      </section>

      {/* Advanced */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <FileWarning className="w-4 h-4" /> {t('settings.advanced')}
        </h2>
        <div className="bg-card border rounded-lg divide-y shadow-sm">
          <div>
            <button
              onClick={handleShowUnmatched}
              className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{t('settings.unmatched_pdfs')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.unmatched_pdfs_desc')}</p>
                </div>
              </div>
              {showUnmatched ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {showUnmatched && (
              <div className="px-4 pb-4">
                {unmatchedPdfs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">{t('settings.no_unmatched')}</p>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {unmatchedPdfs.map((pdf) => (
                      <div
                        key={pdf.id}
                        className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded text-xs"
                      >
                        <div>
                          <p className="font-medium">{pdf.source_filename}</p>
                          <p className="text-muted-foreground capitalize">{pdf.kind}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-4">
            {!confirmClear ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="w-full text-left hover:bg-destructive/5 transition-colors rounded flex items-center gap-3 py-1"
              >
                <Trash2 className="w-4 h-4 text-destructive flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm text-destructive">{t('settings.clear_data')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.clear_data_desc')}</p>
                </div>
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-destructive">{t('settings.clear_confirm')}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleClearAllData}
                    className="px-4 py-1.5 bg-destructive text-destructive-foreground rounded text-sm font-medium hover:opacity-90"
                  >
                    {t('settings.clear_confirm_btn')}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-4 py-1.5 border rounded text-sm font-medium hover:bg-accent"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;
