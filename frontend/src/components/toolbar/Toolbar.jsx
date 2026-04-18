import { Link } from 'react-router-dom';
import {
  RiMenuLine, RiAddLine, RiEditLine, RiDeleteBinLine,
  RiSaveLine, RiCloseLine, RiInformationLine,
  RiRefreshLine, RiLoader4Line, RiArrowLeftLine,
} from 'react-icons/ri';

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
    <div className="h-11 flex items-center justify-between px-4 bg-zinc-900 border-b border-zinc-800 shrink-0">
      {/* Left: back button + breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] min-w-0">
        <Link
          to="/"
          className="flex items-center gap-1 px-2 py-1 rounded text-slate-500 hover:bg-zinc-800 hover:text-slate-200 text-[12px]"
          title="Back to contexts"
        >
          <RiArrowLeftLine size={13} /> Contexts
        </Link>
        <span className="text-slate-700">/</span>
        {contextName && (
          <span className="px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/25 text-violet-300 text-[11px] font-medium truncate" title={contextSlug}>
            {contextName}
          </span>
        )}
        {activeDoc && (
          <>
            <span className="text-slate-700">/</span>
            <span className="text-slate-400 truncate">{activeDoc}.screen.md</span>
          </>
        )}
      </div>

      {/* Right: actions + menu */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Contextual actions */}
        {activeDoc && mode === 'view' && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-slate-400 hover:bg-zinc-800 hover:text-slate-200 transition-colors"
            onClick={onEdit}
            title="Edit"
          >
            <RiEditLine size={13} /> Edit
          </button>
        )}

        {activeDoc && mode === 'edit' && (
          <>
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              onClick={onSave}
              title="Save"
            >
              <RiSaveLine size={13} /> Save
            </button>
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-slate-400 hover:bg-zinc-800 hover:text-slate-200 transition-colors"
              onClick={onCancel}
              title="Cancel editing"
            >
              <RiCloseLine size={13} /> Cancel
            </button>
          </>
        )}

        {activeDoc && mode !== 'metadata' && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-slate-400 hover:bg-zinc-800 hover:text-violet-300 transition-colors"
            onClick={onInfo}
            title="Metadata info"
          >
            <RiInformationLine size={13} /> Info
          </button>
        )}

        {activeDoc && mode === 'metadata' && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] text-slate-400 hover:bg-zinc-800 hover:text-slate-200 transition-colors"
            onClick={onCancel}
            title="Close metadata"
          >
            <RiCloseLine size={13} /> Close
          </button>
        )}

        {activeDoc && (
          <button
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            onClick={onDelete}
            title="Delete"
          >
            <RiDeleteBinLine size={13} />
          </button>
        )}

        {/* Re-index button — shows count badge when there are pending files */}
        <button
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium border transition-colors
            ${isIngesting
              ? 'bg-zinc-800 text-slate-400 border-zinc-700 cursor-wait'
              : pendingCount > 0
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25 hover:border-amber-500/50'
                : 'bg-transparent text-slate-500 border-zinc-700 hover:bg-zinc-800 hover:text-slate-300'}`}
          onClick={isIngesting ? undefined : onIngest}
          disabled={isIngesting}
          title={
            isIngesting ? 'Indexing...' :
            pendingCount > 0 ? `Re-index ${pendingCount} pending file(s)` :
            'All files indexed — click to re-sync anyway'
          }
        >
          {isIngesting
            ? <RiLoader4Line size={14} className="animate-spin" />
            : <RiRefreshLine size={14} />
          }
          <span>Sync</span>
          {pendingCount > 0 && !isIngesting && (
            <span className="ml-0.5 px-1.5 py-[1px] text-[10px] font-bold rounded bg-amber-500/30 text-amber-200">
              {pendingCount}
            </span>
          )}
        </button>

        {/* New button */}
        <button
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium
            bg-violet-600/15 text-violet-300 border border-violet-500/25
            hover:bg-violet-600/25 hover:border-violet-500/40 transition-colors"
          onClick={onNew}
          title="New screen doc"
        >
          <RiAddLine size={14} /> New
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-zinc-700 mx-1" />

        {/* Hamburger menu — opens LLM config drawer */}
        <button
          className="p-1.5 rounded hover:bg-zinc-800 text-slate-400 hover:text-slate-200 transition-colors"
          onClick={onOpenLlm}
          title="Settings"
        >
          <RiMenuLine size={18} />
        </button>
      </div>
    </div>
  );
}
