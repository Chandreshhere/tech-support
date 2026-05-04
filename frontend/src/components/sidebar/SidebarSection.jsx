import { useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from 'react-icons/ri';

export default function SidebarSection({ title, action, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <div
        className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-emerald-500/[0.04] select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-1 font-mono text-[10px] tracking-[0.28em] text-slate-500">
          {open
            ? <RiArrowDownSLine size={13} className="text-emerald-500/70" />
            : <RiArrowRightSLine size={13} className="text-emerald-500/70" />}
          {title}
        </div>
        {action && (
          <button
            className="p-0.5 text-slate-500 hover:text-emerald-400 transition-colors"
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
