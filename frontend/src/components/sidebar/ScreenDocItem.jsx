import { RiMarkdownLine, RiCloseLine } from 'react-icons/ri';

// Git-style colouring on the filename itself — no badges, no dots.
// All state details surface on hover via the tooltip.
//
//   indexed      → normal slate  (clean)
//   stale        → amber         (VS Code "M" modified)
//   not-indexed  → emerald       (VS Code "U" untracked)

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
      className={`flex items-center gap-2 px-3 py-1 cursor-pointer font-mono text-[12px] group
        ${active
          ? 'bg-emerald-500/10 border-l-2 border-emerald-400'
          : 'hover:bg-emerald-500/[0.04] border-l-2 border-transparent'
        }`}
      onClick={() => onSelect(name)}
      title={buildTooltip(name, status, dirty)}
    >
      <RiMarkdownLine size={13} className={`shrink-0 ${iconColor}`} />
      <span className={`truncate flex-1 ${active ? color.active : color.inactive}`}>
        {name}.screen.md
      </span>
      {dirty && <span className="w-1.5 h-1.5 bg-amber-400 shrink-0" title="Unsaved changes" />}

      {onClose && (
        <button
          className="p-0.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-emerald-400 transition-colors"
          onClick={(e) => { e.stopPropagation(); onClose(name); }}
        >
          <RiCloseLine size={12} />
        </button>
      )}
    </div>
  );
}
