import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RiAddLine, RiMoreLine, RiDeleteBinLine, RiPencilLine,
  RiCloseLine, RiLoader4Line, RiArrowRightLine, RiSearchLine,
  RiArrowLeftLine,
} from 'react-icons/ri';
import { listContexts, createContext, updateContext, deleteContext } from '../services/api.js';
import GlitchText from '../components/landing/GlitchText.jsx';

function formatRelativeTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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

// Render a 10-cell ASCII progress bar.
function AsciiBar({ pct }) {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return (
    <span className="font-mono tracking-tight">
      <span className="text-emerald-500/40">[</span>
      <span className="text-emerald-400">{'█'.repeat(filled)}</span>
      <span className="text-zinc-800">{'░'.repeat(10 - filled)}</span>
      <span className="text-emerald-500/40">]</span>
    </span>
  );
}

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="px-3 py-2 border border-red-500/40 bg-red-500/5 font-mono text-[11px] text-red-300 tracking-wider">
      <div>! {error.message}</div>
      {error.suggestion && <div className="text-red-400/70 mt-0.5">→ {error.suggestion}</div>}
    </div>
  );
}

// --- Shared bordered frame (same look as onboarding) ---------------------
function Frame({ title, subtitle, children, footer, onClose, width = 'w-[520px]' }) {
  return (
    <div className={`${width} max-w-[92vw] border border-emerald-500/30 bg-black/85 backdrop-blur-sm shadow-[0_0_40px_rgba(16,185,129,0.08)]`}>
      <div className="flex items-center justify-between border-b border-emerald-500/20 px-5 py-3">
        <div className="flex items-center gap-3 font-mono">
          <span className="text-emerald-400 text-[10px] tracking-[0.28em]">▸</span>
          <span className="text-slate-300 text-[11px] tracking-[0.28em]">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {subtitle && (
            <span className="font-mono text-[10px] tracking-[0.25em] text-slate-500">{subtitle}</span>
          )}
          {onClose && (
            <button onClick={onClose} className="text-slate-500 hover:text-emerald-400 transition-colors">
              <RiCloseLine size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="px-6 py-6">{children}</div>
      {footer && (
        <div className="border-t border-emerald-500/20 px-5 py-3 flex items-center justify-between gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, loading, icon }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] tracking-[0.28em] border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? <RiLoader4Line size={13} className="animate-spin" /> : icon}
      <GlitchText text={typeof children === 'string' ? children : ''} active={hover} />
    </button>
  );
}

function GhostBtn({ children, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-3 py-2 font-mono text-[10px] tracking-[0.28em] text-slate-500 hover:text-emerald-400 transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}

// --- Modals --------------------------------------------------------------

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
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <Frame
          title="PROJECT/SPAWN"
          subtitle="NEW CONTEXT"
          onClose={onClose}
          footer={
            <>
              <GhostBtn onClick={onClose}>CANCEL</GhostBtn>
              <PrimaryBtn onClick={handleCreate} disabled={!name.trim()} loading={saving} icon={<RiAddLine size={13} />}>
                SPAWN
              </PrimaryBtn>
            </>
          }
        >
          {error && <div className="mb-4"><ErrorBanner error={error} /></div>}
          <div className="space-y-3">
            <div>
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">NAME</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreate(); } }}
                placeholder="e.g. discord, figma, local-term"
                className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2"
              />
              <p className="font-mono text-[9px] text-slate-600 mt-1 tracking-wider">
                Must be unique · slug auto-generated · internal id handles storage
              </p>
            </div>
            <div>
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">
                DESCRIPTION <span className="text-slate-700">// optional</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will the agent do here?"
                className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2 resize-none"
              />
            </div>
          </div>
        </Frame>
      </div>
    </div>
  );
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
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <Frame
          title="PROJECT/EDIT"
          subtitle={`ID ${ctx.id.slice(0, 8)}`}
          onClose={onClose}
          footer={
            <>
              <GhostBtn onClick={onClose}>CANCEL</GhostBtn>
              <PrimaryBtn onClick={handleSave} disabled={!name.trim() || !slug} loading={saving}>
                SAVE
              </PrimaryBtn>
            </>
          }
        >
          {error && <div className="mb-4"><ErrorBanner error={error} /></div>}
          <div className="space-y-3">
            <div>
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">NAME</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 px-3 py-2"
              />
              <p className="font-mono text-[9px] text-slate-600 mt-1 tracking-wider">
                Must be unique (case-insensitive)
              </p>
            </div>
            <div>
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">SLUG (URL)</label>
              <div className="flex items-stretch border border-emerald-500/30 hover:border-emerald-500/60 focus-within:border-emerald-400 transition-colors">
                <span className="px-3 py-2 bg-emerald-500/5 font-mono text-[12px] text-emerald-400/70 tracking-wider select-none">/c/</span>
                <input
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  className="flex-1 bg-black font-mono text-[12px] text-slate-200 px-3 py-2 outline-none"
                />
              </div>
              <p className="font-mono text-[9px] text-slate-600 mt-1 tracking-wider">
                URL only · storage uses internal id <span className="text-slate-500">{ctx.id.slice(0, 8)}…</span>
              </p>
            </div>
            <div>
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">DESCRIPTION</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 px-3 py-2 resize-none"
              />
            </div>
          </div>
        </Frame>
      </div>
    </div>
  );
}

// --- Context card --------------------------------------------------------

function ContextCard({ ctx, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const pct = ctx.total > 0 ? Math.round((ctx.indexed / ctx.total) * 100) : 0;
  const pending = ctx.total - ctx.indexed;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative border border-zinc-800 bg-black/50 hover:border-emerald-500/50 hover:bg-emerald-500/[0.02] transition-colors"
    >
      {/* corner glyphs — match landing FeatureCard */}
      <div className="absolute top-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none group-hover:text-emerald-400 transition-colors">┌</div>
      <div className="absolute top-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none group-hover:text-emerald-400 transition-colors">┐</div>
      <div className="absolute bottom-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none group-hover:text-emerald-400 transition-colors">└</div>
      <div className="absolute bottom-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none group-hover:text-emerald-400 transition-colors">┘</div>

      <Link to={`/c/${ctx.slug}`} className="block p-5">
        {/* title row */}
        <div className="flex items-start gap-2 mb-3">
          <span className="font-mono text-emerald-400 text-[11px] leading-tight mt-0.5">▸</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-slate-100 text-[14px] tracking-[0.08em] truncate" title={ctx.name}>
              <GlitchText text={ctx.name.toUpperCase()} active={hover} />
            </h3>
            <p className="font-mono text-[10px] text-slate-500 tracking-wider mt-0.5">/c/{ctx.slug}</p>
          </div>
        </div>

        {/* description */}
        {ctx.description ? (
          <p className="font-mono text-[11px] text-slate-400 leading-relaxed line-clamp-2 mb-4">
            {ctx.description}
          </p>
        ) : (
          <p className="font-mono text-[10px] text-slate-700 tracking-widest mb-4">// NO DESCRIPTION</p>
        )}

        {/* stats block */}
        <div className="border-t border-zinc-900 pt-3 space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-slate-600 tracking-[0.25em]">SCREENS</span>
            <span className="text-slate-200 tracking-wider">
              <span className="text-emerald-400">{ctx.total}</span>
            </span>
          </div>
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-slate-600 tracking-[0.25em]">INDEX</span>
            <div className="flex items-center gap-2">
              <AsciiBar pct={pct} />
              <span className={pending > 0 ? 'text-amber-400 tracking-wider' : 'text-emerald-400 tracking-wider'}>
                {ctx.total === 0 ? 'EMPTY' : pending > 0 ? `${pct}%` : 'SYNC'}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-slate-600 tracking-[0.25em]">UPDATED</span>
            <span className="text-slate-500">{formatRelativeTime(ctx.updated_at)}</span>
          </div>
        </div>

        {/* enter cue — only visible on hover */}
        <div className="mt-3 pt-2 border-t border-zinc-900/80 flex items-center justify-end gap-1 font-mono text-[10px] tracking-[0.28em] text-slate-700 group-hover:text-emerald-400 transition-colors">
          <span>ENTER</span>
          <RiArrowRightLine size={11} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      </Link>

      {/* menu (rename / delete) */}
      <button
        className="absolute top-2 right-2 p-1 text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(!menuOpen); }}
      >
        <RiMoreLine size={14} />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); setMenuOpen(false); }} />
          <div className="absolute top-8 right-2 z-20 bg-black border border-emerald-500/40 py-1 min-w-[140px] shadow-[0_0_20px_rgba(16,185,129,0.15)]">
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-[0.25em] text-slate-300 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
              onClick={(e) => { e.preventDefault(); setMenuOpen(false); onRename(ctx); }}
            >
              <RiPencilLine size={11} /> RENAME
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-[0.25em] text-red-400 hover:bg-red-500/10 transition-colors"
              onClick={(e) => { e.preventDefault(); setMenuOpen(false); onDelete(ctx); }}
            >
              <RiDeleteBinLine size={11} /> DELETE
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Page ----------------------------------------------------------------

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
    if (!confirm(`DELETE "${ctx.name}"?\n\nThis removes ${ctx.total} screen doc(s), the folder contexts/${ctx.slug}/, and the ChromaDB collection. Cannot be undone.`)) return;
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

  const totalScreens = contexts.reduce((n, c) => n + (c.total || 0), 0);
  const totalIndexed = contexts.reduce((n, c) => n + (c.indexed || 0), 0);

  return (
    <div className="min-h-screen bg-black text-slate-200">
      <div className="flex flex-col min-h-screen">
        {/* ===== HEADER ===== */}
        <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-zinc-900">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="font-mono text-[15px] tracking-[0.1em] text-slate-200 hover:text-emerald-300 transition-colors"
            >
              kraken<span className="text-emerald-400">.assist</span>
            </Link>
            <span className="hidden sm:inline-block px-1.5 py-[2px] border border-emerald-500/30 text-emerald-400 text-[9px] font-mono tracking-[0.25em]">
              DASHBOARD
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 font-mono text-[10px] tracking-[0.25em]">
            <div className="flex items-center gap-2">
              <span className="text-slate-600">CTX</span>
              <span className="text-slate-700">::</span>
              <span className="text-emerald-400">{contexts.length.toString().padStart(2, '0')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-600">SCREENS</span>
              <span className="text-slate-700">::</span>
              <span className="text-emerald-400">{totalScreens}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-600">INDEXED</span>
              <span className="text-slate-700">::</span>
              <span className="text-emerald-400">{totalIndexed}/{totalScreens || 0}</span>
            </div>
          </div>

          <PrimaryBtn onClick={() => setShowCreate(true)} icon={<RiAddLine size={13} />}>
            NEW_PROJECT
          </PrimaryBtn>
        </header>

        {/* ===== CONTENT ===== */}
        <main className="flex-1 max-w-6xl mx-auto w-full px-6 md:px-10 py-10">
          {/* Section header */}
          <div className="flex items-center gap-4 mb-6">
            <span className="font-mono text-[10px] tracking-[0.3em] text-emerald-400">[ 0x00 ]</span>
            <span className="font-mono text-[12px] tracking-[0.28em] text-slate-300">PROJECTS</span>
            <span className="flex-1 h-px bg-zinc-900" />
            <span className="font-mono text-[9px] tracking-[0.3em] text-slate-600">
              {filtered.length} / {contexts.length}
            </span>
          </div>

          {/* Search — only when there's enough to bother */}
          {contexts.length > 3 && (
            <div className="mb-6 flex items-stretch border border-zinc-800 hover:border-emerald-500/40 focus-within:border-emerald-400 transition-colors max-w-md">
              <span className="px-3 flex items-center text-emerald-500/60">
                <RiSearchLine size={13} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="QUERY_PROJECTS..."
                className="flex-1 bg-transparent font-mono text-[11px] tracking-[0.2em] text-slate-200 placeholder:text-slate-700 py-2 pr-3 outline-none"
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24 font-mono text-[11px] text-slate-500 tracking-[0.28em]">
              <RiLoader4Line size={14} className="animate-spin mr-2" /> LOADING_PROJECTS…
            </div>
          ) : contexts.length === 0 ? (
            <EmptyState onCreate={() => setShowCreate(true)} />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(ctx => (
                  <ContextCard
                    key={ctx.id}
                    ctx={ctx}
                    onRename={setRenaming}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="py-12 text-center font-mono text-[11px] text-slate-600 tracking-[0.25em]">
                  NO MATCH FOR &quot;{search}&quot;
                </div>
              )}
            </>
          )}
        </main>

        {/* ===== FOOTER ===== */}
        <footer className="border-t border-zinc-900 px-6 md:px-10 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.28em] text-slate-600 hover:text-emerald-400 transition-colors"
          >
            <RiArrowLeftLine size={11} /> BACK_TO_LANDING
          </Link>
          <span className="font-mono text-[9px] tracking-[0.3em] text-slate-700">
            SESSION · LOCAL · NO TELEMETRY
          </span>
        </footer>
      </div>

      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      <RenameModal ctx={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); refresh(); }} />
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <pre className="font-mono text-emerald-400 text-[11px] leading-tight select-none mb-6 opacity-80">
{`  ╔══════════════════════════════╗
  ║  > projects ........ [ 0 ]   ║
  ║  > status .......... [ IDLE ]║
  ║  > awaiting spawn .. [ YES ] ║
  ╚══════════════════════════════╝`}
      </pre>
      <h2 className="font-mono text-slate-100 text-[16px] tracking-[0.12em] mb-2">
        NO PROJECTS YET.
      </h2>
      <p className="font-mono text-[11px] text-slate-500 leading-relaxed text-center max-w-md mb-6">
        A project groups screen docs + vector index for <em>one</em> piece of software the agent will operate.
      </p>
      <PrimaryBtn onClick={onCreate} icon={<RiAddLine size={13} />}>
        SPAWN_FIRST_PROJECT
      </PrimaryBtn>
    </div>
  );
}
