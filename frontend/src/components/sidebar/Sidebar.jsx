import { RiAddLine } from 'react-icons/ri';
import SidebarSection from './SidebarSection.jsx';
import ScreenDocItem from './ScreenDocItem.jsx';

export default function Sidebar({
  screenDocs = [],        // [{ name, status, indexed_at, updated_at }]
  openTabs = [],
  activeDoc,
  dirtyDocs = [],
  onSelectDoc,
  onCloseTab,
  onCreateDoc,
}) {
  const statusMap = new Map(screenDocs.map(d => [d.name, d.status]));

  return (
    <div className="h-full flex flex-col bg-black text-slate-300 select-none">
      <div className="px-3 py-2 border-b border-zinc-900 flex items-center gap-2">
        <span className="text-emerald-400 font-mono text-[10px] tracking-[0.25em]">▸</span>
        <span className="font-mono text-[10px] tracking-[0.3em] text-slate-400">EXPLORER</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <SidebarSection
          title="SCREEN_DOCS"
          defaultOpen={true}
          action={{
            icon: <RiAddLine size={13} />,
            title: 'New screen doc',
            onClick: onCreateDoc,
          }}
        >
          {screenDocs.length === 0 ? (
            <div className="px-4 py-2 font-mono text-[10px] tracking-wider text-slate-700">
              // NO SCREEN DOCS
            </div>
          ) : (
            screenDocs.map((doc) => (
              <ScreenDocItem
                key={doc.name}
                name={doc.name}
                status={doc.status}
                active={activeDoc === doc.name}
                dirty={dirtyDocs.includes(doc.name)}
                onSelect={onSelectDoc}
              />
            ))
          )}
        </SidebarSection>
      </div>

      <div className="border-t border-zinc-900 max-h-[40%] shrink-0 overflow-y-auto">
        <SidebarSection title="OPEN_FILES" defaultOpen={true}>
          {openTabs.length === 0 ? (
            <div className="px-4 py-2 font-mono text-[10px] tracking-wider text-slate-700">
              // NO FILES OPEN
            </div>
          ) : (
            openTabs.map((name) => (
              <ScreenDocItem
                key={name}
                name={name}
                status={statusMap.get(name)}
                active={activeDoc === name}
                dirty={dirtyDocs.includes(name)}
                onSelect={onSelectDoc}
                onClose={onCloseTab}
              />
            ))
          )}
        </SidebarSection>
      </div>
    </div>
  );
}
