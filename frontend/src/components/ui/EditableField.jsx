import { useState, useEffect } from 'react';
import { RiPencilLine, RiCheckLine, RiCloseLine, RiLoader4Line } from 'react-icons/ri';

/**
 * Inline-editable value. Click the pencil (or the value) to edit,
 * save writes to the backend, escape/X cancels.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {(newValue: string) => Promise<void>} props.onSave
 * @param {'text'|'number'|'url'} [props.type='text']
 * @param {boolean} [props.mono]
 */
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
    <div className="flex items-center justify-between py-1 group">
      <span className="text-[11px] text-slate-500 shrink-0 mr-2">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            placeholder={placeholder}
            className={`flex-1 min-w-0 bg-zinc-800 border border-violet-500/50 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none ${mono ? 'font-mono' : ''}`}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-0.5 rounded text-emerald-400 hover:bg-emerald-500/10"
            title="Save (Enter)"
          >
            {saving ? <RiLoader4Line size={12} className="animate-spin" /> : <RiCheckLine size={12} />}
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(String(value ?? '')); }}
            className="p-0.5 rounded text-slate-400 hover:bg-zinc-700"
            title="Cancel (Esc)"
          >
            <RiCloseLine size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0">
          <span className={`text-[11px] text-slate-300 truncate ${mono ? 'font-mono' : ''}`}>
            {value || <span className="text-slate-600 italic">not set</span>}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="p-0.5 rounded text-slate-600 hover:text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Edit"
          >
            <RiPencilLine size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
