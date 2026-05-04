import { useState, useEffect } from 'react';
import { RiPencilLine, RiCheckLine, RiCloseLine, RiLoader4Line } from 'react-icons/ri';

// Inline-editable value. Click the pencil (or the value) to edit,
// save writes to the backend, escape/X cancels.
export default function EditableField({ label, value, onSave, type = 'text', mono = false, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value ?? ''));
  }, [value, editing]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const parsed = type === 'number' ? Number(draft) : draft;
      await onSave(parsed);
      setEditing(false);
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setDraft(String(value ?? '')); }
  };

  return (
    <div className="flex items-center justify-between py-1 group gap-2">
      <span className="font-mono text-[9px] tracking-[0.25em] text-slate-500 shrink-0">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder={placeholder}
            className={`flex-1 min-w-0 bg-black border border-emerald-500/50 hover:border-emerald-400 focus:border-emerald-400 px-1.5 py-0.5 text-[11px] text-slate-200 outline-none ${mono ? 'font-mono' : 'font-mono'}`}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-0.5 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Save (Enter)"
          >
            {saving ? <RiLoader4Line size={12} className="animate-spin" /> : <RiCheckLine size={12} />}
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(String(value ?? '')); }}
            className="p-0.5 text-slate-500 hover:text-red-400 transition-colors"
            title="Cancel (Esc)"
          >
            <RiCloseLine size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0">
          <span className={`text-[11px] text-slate-300 truncate ${mono ? 'font-mono' : 'font-mono'}`}>
            {value || <span className="text-slate-700 italic">not set</span>}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="p-0.5 text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Edit"
          >
            <RiPencilLine size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
