import { useState } from 'react';
import {
  RiKey2Line, RiAddLine, RiDeleteBinLine, RiPencilLine,
  RiCheckLine, RiLoader4Line,
} from 'react-icons/ri';
import api from '../../services/api.js';

const PROVIDER_LABELS = {
  gemini: 'GEMINI',
  groq: 'GROQ',
  openrouter: 'OPENROUTER',
  claude: 'CLAUDE',
};

function KeyRow({ apiKey, activeAssignments, onEdit, onDelete }) {
  const usedBy = activeAssignments.length;

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 bg-black border border-zinc-900 hover:border-emerald-500/40 transition-colors">
      <RiKey2Line size={11} className="text-emerald-500/70 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-200 truncate">{apiKey.name}</span>
          <span className="shrink-0 px-1 py-[1px] font-mono text-[8px] tracking-[0.25em] bg-zinc-900 text-slate-400 border border-zinc-800">
            {PROVIDER_LABELS[apiKey.provider] || apiKey.provider.toUpperCase()}
          </span>
          {usedBy > 0 && (
            <span className="shrink-0 px-1 py-[1px] font-mono text-[8px] tracking-[0.25em] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              IN_USE
            </span>
          )}
        </div>
        <div className="font-mono text-[9px] text-slate-600 mt-0.5">{apiKey.maskedSecret}</div>
        {usedBy > 0 && (
          <div className="font-mono text-[8px] text-slate-600 mt-0.5 tracking-wider">
            → {activeAssignments.join(', ')}
          </div>
        )}
      </div>
      <button
        onClick={() => onEdit(apiKey)}
        className="p-1 text-slate-500 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-colors"
        title="Edit"
      >
        <RiPencilLine size={11} />
      </button>
      <button
        onClick={() => onDelete(apiKey)}
        className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-colors"
        title="Delete"
      >
        <RiDeleteBinLine size={11} />
      </button>
    </div>
  );
}

function KeyForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [provider, setProvider] = useState(initial?.provider || 'gemini');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;

  const handleSave = async () => {
    if (!name.trim() || !provider || (!isEdit && !secret.trim())) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        provider,
        secret: secret.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-2 border border-emerald-500/40 bg-emerald-500/5 space-y-2">
      <div>
        <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-0.5">NAME</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. personal-gemini"
          className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 px-2 py-1 font-mono text-[11px] text-slate-200 placeholder:text-slate-700 outline-none"
        />
      </div>
      <div>
        <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-0.5">PROVIDER</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={isEdit}
          className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none disabled:opacity-50"
        >
          {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
            <option key={id} value={id} className="bg-black">{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-0.5">
          SECRET {isEdit && <span className="text-slate-700 normal-case tracking-normal">(leave blank to keep existing)</span>}
        </label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isEdit ? '••••••••' : 'paste api key here'}
          className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 px-2 py-1 font-mono text-[11px] text-slate-200 placeholder:text-slate-700 outline-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || (!isEdit && !secret.trim())}
          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 font-mono text-[10px] tracking-[0.28em] border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <RiLoader4Line size={11} className="animate-spin" /> : <RiCheckLine size={11} />}
          {isEdit ? 'SAVE' : 'ADD_KEY'}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 font-mono text-[10px] tracking-[0.28em] text-slate-500 hover:text-emerald-400 transition-colors"
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

export default function KeyManager({ keys, activeAssignments, onReload }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const handleAdd = async (data) => {
    await api.post('/keys', data);
    setAdding(false);
    onReload();
  };

  const handleEdit = async (data) => {
    await api.put(`/keys/${editing.id}`, data);
    setEditing(null);
    onReload();
  };

  const handleDelete = async (apiKey) => {
    if (!confirm(`Delete key "${apiKey.name}"?`)) return;
    await api.delete(`/keys/${apiKey.id}`);
    onReload();
  };

  return (
    <div className="space-y-1.5">
      {keys.length === 0 && !adding && (
        <div className="px-2 py-3 font-mono text-[10px] tracking-wider text-slate-600 text-center border border-zinc-900">
          // NO API KEYS YET
        </div>
      )}

      {keys.map((k) => (
        editing?.id === k.id ? (
          <KeyForm
            key={k.id}
            initial={k}
            onSave={handleEdit}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <KeyRow
            key={k.id}
            apiKey={k}
            activeAssignments={activeAssignments[k.id] || []}
            onEdit={setEditing}
            onDelete={handleDelete}
          />
        )
      ))}

      {adding ? (
        <KeyForm onSave={handleAdd} onCancel={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.28em]
            border border-zinc-800 border-dashed text-slate-500
            hover:bg-emerald-500/5 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors"
        >
          <RiAddLine size={12} /> ADD_API_KEY
        </button>
      )}
    </div>
  );
}
