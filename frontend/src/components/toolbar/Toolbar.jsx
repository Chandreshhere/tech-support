import { Link } from 'react-router-dom';
import {
  RiMenuLine, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiSaveLine, RiCloseLine, RiInformationLine,
  RiRefreshLine, RiLoader4Line, RiArrowLeftLine,
} from 'react-icons/ri';

function ToolBtn({ icon, label, onClick, tone = 'default', disabled, title, loading }) {
  const toneCls = {
    default:  'text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/5',
    accent:   'text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 border border-emerald-500/40',
    warn:     'text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 border border-amber-500/40',
    danger:   'text-slate-500 hover:text-red-400 hover:bg-red-500/10',
    muted:    'text-slate-500 hover:text-slate-200 hover:bg-zinc-800/60',
  }[tone];
  return (
    <button
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled || loading}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] tracking-[0.25em] transition-colors ${toneCls} disabled:opacity-40 disabled:cursor-wait`}
    >
      {loading ? <RiLoader4Line size={12} className="animate-spin" /> : icon}
      {label && <span>{label}</span>}
    </button>
  );
}

export default function Toolbar({
  activeDoc,
  mode,
  contextName,
  contextSlug,
  pendingCount = 0,
  isIngesting = false,
  onNew,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onInfo,
  onIngest,
  onOpenLlm,
}) {
  return (
    <div className="h-10 flex items-center justify-between px-4 bg-black border-b border-zinc-900 shrink-0">
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 font-mono text-[11px] min-w-0">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-slate-500 hover:text-emerald-400 transition-colors tracking-[0.25em] text-[10px]"
          title="Back to dashboard"
        >
          <RiArrowLeftLine size={11} /> PROJECTS
        </Link>
        <span className="text-slate-800">/</span>
        {contextName && (
          <span
            className="px-2 py-0.5 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-[10px] tracking-[0.18em] truncate"
            title={contextSlug}
          >
            {contextName.toUpperCase()}
          </span>
        )}
        {activeDoc && (
          <>
            <span className="text-slate-800">/</span>
            <span className="text-slate-400 truncate tracking-wider">{activeDoc}.screen.md</span>
          </>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0">
        {activeDoc && mode === 'view' && (
          <ToolBtn icon={<RiEditLine size={12} />} label="EDIT" onClick={onEdit} title="Edit" />
        )}

        {activeDoc && mode === 'edit' && (
          <>
            <ToolBtn
              icon={<RiSaveLine size={12} />}
              label="SAVE"
              onClick={onSave}
              tone="accent"
              title="Save"
            />
            <ToolBtn
              icon={<RiCloseLine size={12} />}
              label="CANCEL"
              onClick={onCancel}
              tone="muted"
              title="Cancel editing"
            />
          </>
        )}

        {activeDoc && mode !== 'metadata' && (
          <ToolBtn icon={<RiInformationLine size={12} />} label="INFO" onClick={onInfo} title="Metadata info" />
        )}

        {activeDoc && mode === 'metadata' && (
          <ToolBtn icon={<RiCloseLine size={12} />} label="CLOSE" onClick={onCancel} tone="muted" title="Close metadata" />
        )}

        {activeDoc && (
          <ToolBtn icon={<RiDeleteBinLine size={12} />} onClick={onDelete} tone="danger" title="Delete" />
        )}

        <div className="w-px h-4 bg-zinc-800 mx-1" />

        {/* Re-index (sync) */}
        <button
          className={`inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] tracking-[0.25em] border transition-colors
            ${isIngesting
              ? 'border-zinc-800 text-slate-500 cursor-wait'
              : pendingCount > 0
                ? 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:border-amber-400'
                : 'border-zinc-800 text-slate-500 hover:text-emerald-300 hover:border-emerald-500/40'}`}
          onClick={isIngesting ? undefined : onIngest}
          disabled={isIngesting}
          title={
            isIngesting ? 'Indexing...' :
            pendingCount > 0 ? `Re-index ${pendingCount} pending file(s)` :
            'All files indexed — click to re-sync anyway'
          }
        >
          {isIngesting
            ? <RiLoader4Line size={12} className="animate-spin" />
            : <RiRefreshLine size={12} />
          }
          <span>SYNC</span>
          {pendingCount > 0 && !isIngesting && (
            <span className="ml-0.5 px-1 py-[1px] text-[9px] font-bold bg-amber-500/30 text-amber-200">
              {pendingCount}
            </span>
          )}
        </button>

        {/* New doc */}
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] tracking-[0.25em] border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 transition-colors"
          onClick={onNew}
          title="New screen doc"
        >
          <RiAddLine size={12} /> NEW
        </button>

        <div className="w-px h-4 bg-zinc-800 mx-1" />

        {/* Config drawer */}
        <button
          className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/5 transition-colors"
          onClick={onOpenLlm}
          title="Settings"
        >
          <RiMenuLine size={16} />
        </button>
      </div>
    </div>
  );
}
