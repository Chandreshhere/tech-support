import { RiMarkdownLine, RiCloseLine } from 'react-icons/ri';

// VS Code git-style color coding on the filename itself — no badges, no dots.
// All state details surface on hover via the tooltip.
//
//   indexed      → normal slate  (clean state)
//   stale        → amber         (VS Code "M" modified color)
//   not-indexed  → green         (VS Code "U" untracked color)

const FILENAME_COLOR = {
  'indexed':     { inactive: 'text-slate-400',   active: 'text-slate-100' },
  'stale':       { inactive: 'text-amber-400',   active: 'text-amber-300' },
  'not-indexed': { inactive: 'text-emerald-400', active: 'text-emerald-300' },
  'unknown':     { inactive: 'text-slate-500',   active: 'text-slate-300' },
};

const ICON_COLOR = {
  'indexed':     'text-slate-500',
  'stale':       'text-amber-500/70',
  'not-indexed': 'text-emerald-500/70',
  'unknown':     'text-slate-600',
};

function buildTooltip(name, status, dirty) {
  const parts = [`${name}.screen.md`];
  if (status === 'indexed')     parts.push('Indexed & up to date');
  if (status === 'stale')       parts.push('Stale — file was edited after last indexing');
  if (status === 'not-indexed') parts.push('Not indexed yet — never embedded in ChromaDB');
  if (dirty)                    parts.push('Unsaved changes in editor');
  return parts.join('\n');
}

export default function ScreenDocItem({ name, active, dirty, status, onSelect, onClose }) {
  const color = FILENAME_COLOR[status] || FILENAME_COLOR.unknown;
  const iconColor = ICON_COLOR[status] || ICON_COLOR.unknown;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1 cursor-pointer text-[13px] group
        ${active
          ? 'bg-zinc-800 border-l-2 border-violet-500'
          : 'hover:bg-zinc-800/40 border-l-2 border-transparent'
        }`}
      onClick={() => onSelect(name)}
      title={buildTooltip(name, status, dirty)}
    >
      <RiMarkdownLine size={14} className={`shrink-0 ${iconColor}`} />
      <span className={`truncate flex-1 ${active ? color.active : color.inactive}`}>
        {name}.screen.md
      </span>

      {onClose && (
        <button
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-600 text-slate-500 hover:text-slate-200"
          onClick={(e) => { e.stopPropagation(); onClose(name); }}
        >
          <RiCloseLine size={12} />
        </button>
      )}
    </div>
  );
}
