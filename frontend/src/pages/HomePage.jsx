import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RiAddLine, RiFolderLine, RiMoreLine, RiSettingsLine,
  RiDeleteBinLine, RiPencilLine, RiCloseLine, RiLoader4Line,
} from 'react-icons/ri';
import { listContexts, createContext, updateContext, deleteContext } from '../services/api.js';

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-[12px] text-red-300">
      <div className="font-medium">{error.message}</div>
      {error.suggestion && <div className="text-red-300/80 mt-0.5">{error.suggestion}</div>}
    </div>
  );
}

function CreateModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await createContext({ name: name.trim(), description: description.trim() });
      onCreate(data);
      setName(''); setDescription('');
    } catch (err) {
      setError({
        message: err.response?.data?.error || err.message,
        suggestion: err.response?.data?.suggestion,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[480px] max-w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium text-slate-200">New Software Context</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <RiCloseLine size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <ErrorBanner error={error} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              autoFocus
              placeholder="e.g. Discord, Slack, Figma"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Must be unique. A URL-safe slug will be auto-generated (e.g. "My Discord" → "my-discord")
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this context for?"
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-1.5 rounded text-sm text-slate-400 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
          >
            {saving ? <RiLoader4Line size={14} className="animate-spin" /> : <RiAddLine size={14} />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function RenameModal({ ctx, onClose, onSaved }) {
  const [name, setName] = useState(ctx?.name || '');
  const [slug, setSlug] = useState(ctx?.slug || '');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState(ctx?.description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!ctx) return null;

  const handleNameChange = (v) => {
    setName(v);
    setError(null);
    // Auto-update slug unless user explicitly edited it
    if (!slugManuallyEdited) setSlug(slugify(v));
  };

  const handleSlugChange = (v) => {
    setSlugManuallyEdited(true);
    setSlug(slugify(v));
    setError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), description: description.trim() };
      // Only send slug if user changed it from what the server generated
      if (slug !== ctx.slug) payload.slug = slug;
      const { data } = await updateContext(ctx.id, payload);
      onSaved(data);
    } catch (err) {
      setError({
        message: err.response?.data?.error || err.message,
        suggestion: err.response?.data?.suggestion,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-[480px] max-w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium text-slate-200">Edit Context</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <RiCloseLine size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <ErrorBanner error={error} />
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoFocus
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50"
            />
            <p className="text-[10px] text-slate-600 mt-1">Must be unique (case-insensitive).</p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Slug (URL)</label>
            <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 focus-within:border-violet-500/50">
              <span className="text-slate-600 text-sm font-mono">/c/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className="flex-1 bg-transparent text-sm text-slate-200 font-mono outline-none"
              />
            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              Changes the URL only. Physical storage (folder + ChromaDB) uses the internal id —
              <span className="font-mono"> {ctx.id.slice(0, 8)}…</span> — and is unaffected.
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button onClick={onClose} className="px-4 py-1.5 rounded text-sm text-slate-400 hover:bg-zinc-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !slug || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
          >
            {saving ? <RiLoader4Line size={14} className="animate-spin" /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ContextCard({ ctx, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pct = ctx.total > 0 ? Math.round((ctx.indexed / ctx.total) * 100) : 0;
  const pending = ctx.total - ctx.indexed;

  return (
    <div className="group relative rounded-xl border border-zinc-800 bg-zinc-900 hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/5 transition-all">
      <Link to={`/c/${ctx.slug}`} className="block p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
            <RiFolderLine size={18} className="text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-100 truncate" title={ctx.name}>{ctx.name}</h3>
            <p className="text-[11px] text-slate-500 font-mono">{ctx.slug}</p>
          </div>
        </div>
        {ctx.description && (
          <p className="text-[12px] text-slate-400 mt-3 line-clamp-2">{ctx.description}</p>
        )}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-slate-400">
              <span className="text-slate-200 font-medium">{ctx.total}</span> screen{ctx.total !== 1 ? 's' : ''}
            </span>
            <span className={pending > 0 ? 'text-amber-400' : 'text-emerald-400'}>
              {pending > 0 ? `${pending} pending` : 'all indexed'}
            </span>
          </div>
          <span className="text-[10px] text-slate-600">{formatRelativeTime(ctx.updated_at)}</span>
        </div>
        {/* Index progress bar */}
        {ctx.total > 0 && (
          <div className="mt-2 h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full ${pct === 100 ? 'bg-emerald-500' : 'bg-violet-500'} transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </Link>
      {/* Menu button */}
      <button
        className="absolute top-3 right-3 p-1.5 rounded opacity-0 group-hover:opacity-100 text-slate-500 hover:bg-zinc-800 hover:text-slate-200 transition-opacity"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(!menuOpen); }}
      >
        <RiMoreLine size={14} />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setMenuOpen(false); }} />
          <div className="absolute top-10 right-3 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[140px]">
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-zinc-700"
              onClick={(e) => { e.preventDefault(); setMenuOpen(false); onRename(ctx); }}
            >
              <RiPencilLine size={12} /> Rename
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10"
              onClick={(e) => { e.preventDefault(); setMenuOpen(false); onDelete(ctx); }}
            >
              <RiDeleteBinLine size={12} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [search, setSearch] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await listContexts();
      setContexts(data.contexts || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = (newCtx) => {
    setShowCreate(false);
    refresh();
    navigate(`/c/${newCtx.slug}`);
  };

  const handleDelete = async (ctx) => {
    if (!confirm(`Delete context "${ctx.name}"?\n\nThis removes ${ctx.total} screen doc(s), the folder contexts/${ctx.slug}/, and the ChromaDB collection. Cannot be undone.`)) return;
    try {
      await deleteContext(ctx.id);
      refresh();
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const filtered = contexts.filter(c =>
    !search.trim() ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.slug.includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-violet-400">kraken-assist</h1>
            <p className="text-[11px] text-slate-500">Software contexts — each app has its own screen docs + vector index</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            <RiAddLine size={16} /> New Context
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <RiLoader4Line size={20} className="animate-spin" />
          </div>
        ) : contexts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-violet-600/10 border border-violet-500/30 flex items-center justify-center mb-4">
              <RiFolderLine size={32} className="text-violet-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200 mb-1">No software contexts yet</h2>
            <p className="text-sm text-slate-500 mb-6 max-w-sm">
              A context holds all the screen documentation for one app (Discord, Slack, etc.) along with its own vector index.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
            >
              <RiAddLine size={16} /> Create your first context
            </button>
          </div>
        ) : (
          <>
            {contexts.length > 3 && (
              <input
                type="text"
                placeholder="Search contexts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50 mb-6"
              />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((ctx) => (
                <ContextCard
                  key={ctx.id}
                  ctx={ctx}
                  onRename={setRenaming}
                  onDelete={handleDelete}
                />
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No contexts match "{search}"</p>
            )}
          </>
        )}
      </div>

      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      <RenameModal ctx={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); refresh(); }} />
    </div>
  );
}
