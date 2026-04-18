import { useState, useEffect } from 'react';
import {
  RiCloseLine, RiInformationLine, RiStickyNoteLine,
  RiCheckLine, RiLoader4Line,
} from 'react-icons/ri';

const STATUS_LABELS = {
  'indexed':     { label: 'Indexed', color: 'text-emerald-400 bg-emerald-500/10' },
  'stale':       { label: 'Stale',   color: 'text-amber-400 bg-amber-500/10' },
  'not-indexed': { label: 'Not indexed', color: 'text-slate-400 bg-slate-500/10' },
  'unknown':     { label: 'Unknown', color: 'text-slate-500 bg-zinc-800' },
};

function formatDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Row({ label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="text-[11px] text-slate-500 w-28 shrink-0 uppercase tracking-wider">{label}</span>
      <span className={`text-[12px] text-slate-300 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

export default function MetadataPanel({ docName, cApi, onClose }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!docName || !cApi) return;
    setLoading(true);
    cApi.getMeta(docName).then(({ data }) => {
      setMeta(data);
      setNotes(data.customNotes || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [docName, cApi]);

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await cApi.saveMeta(docName, notes);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (err) {
      alert('Failed to save notes: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const statusInfo = STATUS_LABELS[meta?.status] || STATUS_LABELS.unknown;
  const dirty = meta && notes !== (meta.customNotes || '');

  return (
    <div className="flex-1 overflow-y-auto bg-[#0f1117]">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-4">
          <div className="flex items-center gap-2">
            <RiInformationLine size={18} className="text-violet-400" />
            <h2 className="text-[15px] font-medium text-slate-200">
              {docName}.screen.md
            </h2>
            {meta && (
              <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-slate-400 hover:text-slate-200">
            <RiCloseLine size={16} />
          </button>
        </div>

        {loading ? (
          <div className="text-slate-500 text-sm py-8 text-center">Loading metadata...</div>
        ) : !meta ? (
          <div className="text-slate-500 text-sm py-8 text-center">Failed to load metadata</div>
        ) : (
          <>
            {/* File info */}
            <section className="mb-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                File Information
              </h3>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3">
                <Row label="Name" value={`${meta.name}.screen.md`} mono />
                <Row label="Path" value={meta.filePath} mono />
                <Row label="Size" value={formatBytes(meta.size)} />
                <Row label="Created (FS)" value={formatDate(meta.birthtime)} />
                <Row label="Modified (FS)" value={formatDate(meta.mtime)} />
                <Row label="Created (DB)" value={formatDate(meta.createdAt)} />
                <Row label="Updated (DB)" value={formatDate(meta.updatedAt)} />
              </div>
            </section>

            {/* Index info */}
            <section className="mb-6">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                ChromaDB Index
              </h3>
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3">
                <Row label="Status" value={
                  <span className={statusInfo.color.split(' ')[0]}>{statusInfo.label}</span>
                } />
                <Row label="Indexed at" value={formatDate(meta.indexedAt)} />
                <Row label="File hash" value={meta.fileHash || '—'} mono />
                <Row label="Indexed hash" value={meta.indexedHash || '—'} mono />
                {meta.status === 'stale' && (
                  <div className="mt-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                    File was edited after last indexing. Re-index to sync ChromaDB with current content.
                  </div>
                )}
                {meta.status === 'not-indexed' && (
                  <div className="mt-2 px-3 py-2 rounded bg-slate-500/10 border border-slate-500/20 text-[11px] text-slate-400">
                    This file has never been indexed. Run Re-index from the settings drawer.
                  </div>
                )}
              </div>
            </section>

            {/* Custom notes */}
            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <RiStickyNoteLine size={12} />
                  Custom Metadata Notes
                </h3>
                <div className="flex items-center gap-2">
                  {savedAt && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 animate-fade-in">
                      <RiCheckLine size={12} /> Saved
                    </span>
                  )}
                  <button
                    onClick={handleSaveNotes}
                    disabled={!dirty || saving}
                    className={`px-3 py-1 rounded text-[11px] font-medium transition-colors
                      ${dirty && !saving
                        ? 'bg-violet-600 hover:bg-violet-500 text-white'
                        : 'bg-zinc-800 text-slate-600 cursor-not-allowed'}`}
                  >
                    {saving ? <RiLoader4Line size={12} className="animate-spin" /> : 'Save Notes'}
                  </button>
                </div>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add custom notes about this screen doc. These will be included as metadata alongside the vector embedding in ChromaDB."
                className="w-full min-h-[140px] bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2
                  text-[13px] text-slate-300 font-mono resize-y outline-none focus:border-violet-500/50
                  placeholder:text-slate-600"
              />
              <p className="text-[10px] text-slate-600 mt-1.5">
                Notes are stored locally and will be attached to the ChromaDB document metadata on next re-index.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
