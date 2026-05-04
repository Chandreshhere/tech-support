import { RiMarkdownLine, RiCloseLine } from 'react-icons/ri';

export default function TabBar({ tabs, activeDoc, dirtyDocs = [], onSelect, onClose }) {
  if (!tabs || tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-black border-b border-zinc-900 overflow-x-auto shrink-0">
      {tabs.map((name) => {
        const isActive = name === activeDoc;
        const isDirty = dirtyDocs.includes(name);
        return (
          <div
            key={name}
            className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] cursor-pointer border-r border-zinc-900 group shrink-0 transition-colors
              ${isActive
                ? 'bg-emerald-500/[0.04] text-slate-200 border-t-2 border-t-emerald-400'
                : 'bg-black text-slate-500 hover:text-slate-300 hover:bg-emerald-500/[0.02] border-t-2 border-t-transparent'
              }`}
            onClick={() => onSelect(name)}
          >
            <RiMarkdownLine size={11} className={`shrink-0 ${isActive ? 'text-emerald-500/70' : 'text-slate-600'}`} />
            <span className="truncate max-w-[140px]">{name}.screen.md</span>
            {isDirty && <span className="w-1.5 h-1.5 bg-amber-400 shrink-0" />}
            <button
              className="p-0.5 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-emerald-400 ml-1 transition-colors"
              onClick={(e) => { e.stopPropagation(); onClose(name); }}
            >
              <RiCloseLine size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
