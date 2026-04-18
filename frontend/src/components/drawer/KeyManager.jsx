import { useState } from 'react';
import {
  RiKey2Line, RiAddLine, RiDeleteBinLine, RiPencilLine,
  RiCheckLine, RiCloseLine, RiLoader4Line,
} from 'react-icons/ri';
import api from '../../services/api.js';

const PROVIDER_LABELS = {
  gemini: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  custom: 'Custom',
};

function KeyRow({ apiKey, activeAssignments, onEdit, onDelete }) {
  // activeAssignments: array of slot names this key is currently active for
  // (e.g. ['llm.gemini'] if config.llm.gemini.activeKeyId === apiKey.id)
  const usedBy = activeAssignments.length;

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/40 hover:bg-zinc-800/70">
      <RiKey2Line size={12} className="text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-200 truncate">{apiKey.name}</span>
          <span className="shrink-0 px-1 py-[1px] text-[9px] font-semibold uppercase rounded bg-zinc-700 text-slate-400">
            {PROVIDER_LABELS[apiKey.provider] || apiKey.provider}
          </span>
          {usedBy > 0 && (
            <span className="shrink-0 px-1 py-[1px] text-[9px] font-semibold uppercase rounded bg-emerald-500/15 text-emerald-400">
              In use
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-600 font-mono">{apiKey.maskedSecret}</div>
        {usedBy > 0 && (
          <div className="text-[9px] text-slate-600 mt-0.5">
            Used by: {activeAssignments.join(', ')}
          </div>
        )}
      </div>
      <button
        onClick={() => onEdit(apiKey)}
        className="p-1 rounded text-slate-500 hover:bg-zinc-700 hover:text-slate-300 opacity-0 group-hover:opacity-100"
        title="Edit"
      >
        <RiPencilLine size={11} />
      </button>
      <button
        onClick={() => onDelete(apiKey)}
        className="p-1 rounded text-slate-500 hover:bg-red-500/10 hover:text-red-400 opacity-0 group-hover:opacity-100"
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
        secret: secret.trim() || undefined, // when editing, omit if blank = keep old
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-2 rounded border border-violet-500/30 bg-violet-500/5 space-y-2">
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Personal Gemini"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-violet-500/50"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5">Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={isEdit}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-violet-500/50 disabled:opacity-50"
        >
          {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5">
          Secret {isEdit && <span className="text-slate-600 normal-case">(leave blank to keep existing)</span>}
        </label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={isEdit ? '••••••••' : 'Paste API key here'}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[12px] text-slate-200 font-mono outline-none focus:border-violet-500/50"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || (!isEdit && !secret.trim())}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
        >
          {saving ? <RiLoader4Line size={11} className="animate-spin" /> : <RiCheckLine size={11} />}
          {isEdit ? 'Save' : 'Add Key'}
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 rounded text-[11px] text-slate-400 hover:bg-zinc-800"
        >
          Cancel
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
        <div className="px-2 py-3 text-[11px] text-slate-500 italic text-center bg-zinc-800/30 rounded">
          No API keys yet — add one below
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
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium
            bg-zinc-800/50 text-slate-400 border border-zinc-700 border-dashed
            hover:bg-zinc-800 hover:text-slate-200 hover:border-violet-500/40 transition-colors"
        >
          <RiAddLine size={12} /> Add API Key
        </button>
      )}
    </div>
  );
}
