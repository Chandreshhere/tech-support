import { RiMarkdownLine, RiCloseLine } from 'react-icons/ri';

export default function TabBar({ tabs, activeDoc, dirtyDocs = [], onSelect, onClose }) {
  if (!tabs || tabs.length === 0) return null;

  return (
    <div className="flex items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto shrink-0">
      {tabs.map((name) => {
        const isActive = name === activeDoc;
        const isDirty = dirtyDocs.includes(name);
        return (
          <div
            key={name}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer border-r border-zinc-800 group shrink-0
              ${isActive
                ? 'bg-[#0f1117] text-slate-200 border-t-2 border-t-violet-500'
                : 'bg-zinc-900 text-slate-500 hover:text-slate-300 border-t-2 border-t-transparent'
              }`}
            onClick={() => onSelect(name)}
          >
            <RiMarkdownLine size={12} className="shrink-0 text-slate-500" />
            <span className="truncate max-w-[120px]">{name}.screen.md</span>
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
            <button
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-700 text-slate-500 hover:text-slate-200 ml-1"
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
