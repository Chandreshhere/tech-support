import { useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from 'react-icons/ri';

export default function SidebarSection({ title, action, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-zinc-800/50 select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {open ? <RiArrowDownSLine size={14} /> : <RiArrowRightSLine size={14} />}
          {title}
        </div>
        {action && (
          <button
            className="p-0.5 rounded hover:bg-zinc-700 text-slate-400 hover:text-slate-200"
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            title={action.title}
          >
            {action.icon}
          </button>
        )}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}
