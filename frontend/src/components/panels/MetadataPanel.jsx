import { useState, useEffect } from 'react';
import {
  RiCloseLine, RiStickyNoteLine,
  RiCheckLine, RiLoader4Line,
} from 'react-icons/ri';

const STATUS_LABELS = {
  'indexed':     { label: 'INDEXED',     color: 'text-emerald-400' },
  'stale':       { label: 'STALE',       color: 'text-amber-400' },
  'not-indexed': { label: 'NOT_INDEXED', color: 'text-slate-400' },
  'unknown':     { label: 'UNKNOWN',     color: 'text-slate-500' },
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
    <div className="flex items-start gap-3 py-1">
      <span className="font-mono text-[9px] text-slate-500 w-28 shrink-0 tracking-[0.25em]">{label}</span>
      <span className={`text-[11px] text-slate-300 break-all ${mono ? 'font-mono' : 'font-mono'}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-5">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-emerald-400 font-mono text-[9px]">▸</span>
        <span className="font-mono text-[10px] tracking-[0.28em] text-slate-400">{title}</span>
        <span className="flex-1 h-px bg-zinc-900" />
      </div>
      <div className="border border-zinc-800 bg-black px-4 py-3 relative">
        <div className="absolute top-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┌</div>
        <div className="absolute top-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┐</div>
        <div className="absolute bottom-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">└</div>
        <div className="absolute bottom-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┘</div>
        {children}
      </div>
    </section>
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
    <div className="flex-1 overflow-y-auto bg-black">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-900 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-emerald-400 font-mono text-[11px]">▸</span>
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">META</span>
            <span className="text-slate-700">::</span>
            <span className="font-mono text-[13px] text-slate-200 truncate">{docName}.screen.md</span>
            {meta && (
              <span className={`ml-1 px-2 py-[1px] border border-current/30 font-mono text-[9px] tracking-[0.25em] ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>

        {loading ? (
          <div className="font-mono text-[11px] tracking-[0.28em] text-slate-500 py-8 text-center">
            <RiLoader4Line size={13} className="inline animate-spin mr-2" /> LOADING_META…
          </div>
        ) : !meta ? (
          <div className="font-mono text-[11px] tracking-[0.28em] text-red-400 py-8 text-center">
            FAILED TO LOAD METADATA
          </div>
        ) : (
          <>
            <Section title="FILE_INFORMATION">
              <Row label="NAME"         value={`${meta.name}.screen.md`} mono />
              <Row label="PATH"         value={meta.filePath} mono />
              <Row label="SIZE"         value={formatBytes(meta.size)} />
              <Row label="CREATED_FS"   value={formatDate(meta.birthtime)} />
              <Row label="MODIFIED_FS"  value={formatDate(meta.mtime)} />
              <Row label="CREATED_DB"   value={formatDate(meta.createdAt)} />
              <Row label="UPDATED_DB"   value={formatDate(meta.updatedAt)} />
            </Section>

            <Section title="CHROMADB_INDEX">
              <Row label="STATUS"       value={<span className={statusInfo.color}>{statusInfo.label}</span>} />
              <Row label="INDEXED_AT"   value={formatDate(meta.indexedAt)} />
              <Row label="FILE_HASH"    value={meta.fileHash || '—'} mono />
              <Row label="INDEXED_HASH" value={meta.indexedHash || '—'} mono />
              {meta.status === 'stale' && (
                <div className="mt-2 px-3 py-2 border border-amber-500/30 bg-amber-500/5 font-mono text-[10px] text-amber-300 leading-relaxed tracking-wider">
                  FILE WAS EDITED AFTER LAST INDEXING. RE-INDEX TO SYNC CHROMADB WITH CURRENT CONTENT.
                </div>
              )}
              {meta.status === 'not-indexed' && (
                <div className="mt-2 px-3 py-2 border border-emerald-500/25 bg-emerald-500/5 font-mono text-[10px] text-emerald-300 leading-relaxed tracking-wider">
                  NEVER INDEXED. RUN RE-INDEX FROM THE CONFIG DRAWER.
                </div>
              )}
            </Section>

            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400 font-mono text-[9px]">▸</span>
                  <span className="font-mono text-[10px] tracking-[0.28em] text-slate-400 flex items-center gap-1.5">
                    <RiStickyNoteLine size={12} /> CUSTOM_NOTES
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {savedAt && (
                    <span className="font-mono text-[10px] tracking-[0.25em] text-emerald-400 flex items-center gap-1 animate-fade-in">
                      <RiCheckLine size={11} /> SAVED
                    </span>
                  )}
                  <button
                    onClick={handleSaveNotes}
                    disabled={!dirty || saving}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] tracking-[0.28em] border transition-colors
                      ${dirty && !saving
                        ? 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200'
                        : 'border-zinc-800 text-slate-700 cursor-not-allowed'}`}
                  >
                    {saving ? <RiLoader4Line size={11} className="animate-spin" /> : null}
                    SAVE_NOTES
                  </button>
                </div>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="// add custom notes about this screen doc. attached as metadata on next re-index."
                className="w-full min-h-[140px] bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 px-3 py-2
                  font-mono text-[12px] text-slate-300 resize-y outline-none transition-colors
                  placeholder:text-slate-700 caret-emerald-400"
              />
              <p className="font-mono text-[9px] tracking-wider text-slate-600 mt-1.5">
                STORED LOCALLY · ATTACHED TO CHROMADB METADATA ON NEXT RE-INDEX
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
