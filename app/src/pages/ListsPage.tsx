import React, { useEffect, useState } from 'react';
import { select, execute } from '../lib/db';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, ChevronRight, List, X,
} from 'lucide-react';
interface ProblemList {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  total: number;
  attempted: number;
  dist0: number; dist1: number; dist2: number; dist3: number; dist4: number;
}

const MASTERY_COLORS = [
  'bg-muted',
  'bg-red-400',
  'bg-yellow-400',
  'bg-blue-400',
  'bg-green-500',
];
const MASTERY_LABELS = ['Unseen', 'M1', 'M2', 'M3', 'M4'];

// SVG donut ring
const ProgressRing: React.FC<{ solved: number; total: number; size?: number }> = ({
  solved, total, size = 72,
}) => {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? solved / total : 0;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={6} className="text-muted" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={6} className="text-primary"
        strokeDasharray={`${pct * circ} ${circ}`}
        strokeLinecap="round"
        style={{ transform: `rotate(-90deg)`, transformOrigin: '50% 50%' }} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle"
        fontSize="13" fontWeight="700" fill="currentColor" className="fill-foreground">
        {total > 0 ? Math.round(pct * 100) : 0}%
      </text>
    </svg>
  );
};

const ListsPage: React.FC = () => {
  const navigate = useNavigate();
  const [lists, setLists] = useState<ProblemList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const fetchLists = async () => {
    try {
      const data = await select<ProblemList>(`
        SELECT
          pl.id, pl.name, pl.description, pl.created_at,
          COUNT(li.pid) AS total,
          COUNT(CASE WHEN ps.total_attempts > 0 THEN 1 END) AS attempted,
          COUNT(CASE WHEN COALESCE(ps.current_mastery,0) = 0 THEN 1 END) AS dist0,
          COUNT(CASE WHEN COALESCE(ps.current_mastery,0) = 1 THEN 1 END) AS dist1,
          COUNT(CASE WHEN COALESCE(ps.current_mastery,0) = 2 THEN 1 END) AS dist2,
          COUNT(CASE WHEN COALESCE(ps.current_mastery,0) = 3 THEN 1 END) AS dist3,
          COUNT(CASE WHEN COALESCE(ps.current_mastery,0) = 4 THEN 1 END) AS dist4
        FROM problem_lists pl
        LEFT JOIN list_items li ON li.list_id = pl.id
        LEFT JOIN problem_state ps ON ps.pid = li.pid AND ps.course_id = li.course_id
        GROUP BY pl.id
        ORDER BY pl.name ASC
      `);
      setLists(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLists(); }, []);

  const createList = async () => {
    if (!newName.trim()) return;
    await execute(
      `INSERT INTO problem_lists (name, description) VALUES (?, ?)`,
      [newName.trim(), newDesc.trim() || null]
    );
    setNewName(''); setNewDesc(''); setShowCreate(false);
    await fetchLists();
  };

  const deleteList = async (id: number) => {
    await execute(`DELETE FROM list_items WHERE list_id = ?`, [id]);
    await execute(`DELETE FROM problem_lists WHERE id = ?`, [id]);
    setConfirmDelete(null);
    await fetchLists();
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lists</h1>
          <p className="text-muted-foreground mt-1">Curated problem sets to track focused progress.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-bold hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New List
        </button>
      </header>

      {lists.length === 0 && (
        <div className="border-2 border-dashed rounded-xl p-16 text-center space-y-3 text-muted-foreground">
          <List className="w-10 h-10 mx-auto opacity-30" />
          <p>No lists yet. Create one to track a curated set of problems.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {lists.map(list => {
          const dist = [list.dist0, list.dist1, list.dist2, list.dist3, list.dist4];
          const mastered = list.dist3 + list.dist4;

          return (
            <div key={list.id}
              className="bg-card border rounded-xl p-5 hover:shadow-md transition-shadow group flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold truncate">{list.name}</h2>
                  {list.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{list.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setConfirmDelete(list.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-4">
                <ProgressRing solved={mastered} total={list.total} />
                <div className="flex-1 space-y-1.5">
                  <div className="text-sm">
                    <span className="font-bold">{list.total}</span>
                    <span className="text-muted-foreground"> problems</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {list.attempted} attempted · {mastered} mastered
                  </div>
                  {/* Mastery distribution bar */}
                  {list.total > 0 && (
                    <div className="flex rounded overflow-hidden h-2 gap-px">
                      {dist.map((count, i) => count > 0 && (
                        <div
                          key={i}
                          className={MASTERY_COLORS[i]}
                          style={{ width: `${(count / list.total) * 100}%` }}
                          title={`${MASTERY_LABELS[i]}: ${count}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-1 border-t">
                <button
                  onClick={() => navigate(`/problems?list=${list.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-accent transition-colors"
                >
                  Browse <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background border rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold">New List</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-accent rounded-md">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Name *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createList()}
                  placeholder="e.g. Fall 2024 Weak Topics"
                  autoFocus
                  className="w-full px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border rounded-md bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button
                onClick={createList}
                disabled={!newName.trim()}
                className="flex-1 py-2 bg-primary text-primary-foreground rounded-md font-medium text-sm hover:opacity-90 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 border rounded-md text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-background border rounded-xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <h2 className="font-bold">Delete list?</h2>
            <p className="text-sm text-muted-foreground">
              This will remove the list and all its problem assignments. The problems themselves are not deleted.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => deleteList(confirmDelete)}
                className="flex-1 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-2 border rounded-md text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListsPage;
