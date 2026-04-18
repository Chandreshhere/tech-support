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
  // Build a name → status map for O(1) lookups
  const statusMap = new Map(screenDocs.map(d => [d.name, d.status]));

  return (
    <div className="h-full flex flex-col bg-[#0f1117] text-slate-300 select-none">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-500 border-b border-zinc-800">
        Explorer
      </div>

      <div className="flex-1 overflow-y-auto">
        <SidebarSection
          title="Screen Docs"
          defaultOpen={true}
          action={{
            icon: <RiAddLine size={14} />,
            title: 'New screen doc',
            onClick: onCreateDoc,
          }}
        >
          {screenDocs.length === 0 ? (
            <div className="px-4 py-2 text-[12px] text-slate-600 italic">
              No screen docs yet
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

      <div className="border-t border-zinc-800 max-h-[40%] shrink-0 overflow-y-auto">
        <SidebarSection title="Open Files" defaultOpen={true}>
          {openTabs.length === 0 ? (
            <div className="px-4 py-2 text-[12px] text-slate-600 italic">
              No files open
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
