import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  RiKey2Line, RiAddLine, RiDeleteBinLine, RiCheckLine, RiLoader4Line,
  RiArrowRightLine, RiArrowLeftLine, RiEyeLine, RiCloseLine,
  RiFolderLine,
} from 'react-icons/ri';
import {
  getKeys, createKey, deleteKey,
  patchConfig,
  listContexts, createContext,
} from '../services/api.js';
import AsciiRain from '../components/landing/AsciiRain.jsx';
import GlitchText from '../components/landing/GlitchText.jsx';
import { markOnboarded } from '../utils/user.js';

// Mirrors the catalog in LlmDrawer. Kept in sync manually — the agent is the
// source of truth for which model IDs actually work.
const PROVIDERS = {
  gemini: {
    name: 'GOOGLE GEMINI',
    hint: 'aistudio.google.com/apikey',
    models: [
      { id: 'gemini-2.5-flash',          name: 'Gemini 2.5 Flash',       ctx: '1M',   out: '65K', vision: true, recommended: true },
      { id: 'gemini-2.5-flash-lite',     name: 'Gemini 2.5 Flash Lite',  ctx: '1M',   out: '65K', vision: true },
      { id: 'gemini-2.0-flash',          name: 'Gemini 2.0 Flash',       ctx: '1M',   out: '8K',  vision: true },
      { id: 'gemini-3-flash-preview',    name: 'Gemini 3 Flash Preview', ctx: '1M',   out: '65K', vision: true },
    ],
  },
  groq: {
    name: 'GROQ',
    hint: 'console.groq.com/keys',
    models: [
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', ctx: '128K', out: '8K',  vision: true, recommended: true },
      { id: 'llama-3.3-70b-versatile',                    name: 'Llama 3.3 70B',     ctx: '128K', out: '32K', vision: false },
      { id: 'llama-3.1-8b-instant',                       name: 'Llama 3.1 8B',      ctx: '128K', out: '8K',  vision: false },
      { id: 'qwen/qwen3-32b',                             name: 'Qwen 3 32B',        ctx: '128K', out: '32K', vision: false },
    ],
  },
  openrouter: {
    name: 'OPENROUTER',
    hint: 'openrouter.ai/keys',
    models: [
      { id: 'qwen/qwen2.5-vl-72b-instruct',     name: 'Qwen2.5-VL 72B (paid)', ctx: '128K', out: '8K', vision: true, recommended: true },
      { id: 'qwen/qwen2.5-vl-32b-instruct',     name: 'Qwen2.5-VL 32B (paid)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-27b-it:free',       name: 'Gemma 3 27B (free)',    ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-12b-it:free',       name: 'Gemma 3 12B (free)',    ctx: '128K', out: '8K', vision: true },
    ],
  },
};

const STEPS = [
  { id: 0, key: 'welcome', label: 'WELCOME' },
  { id: 1, key: 'keys',    label: 'AUTH_KEYS' },
  { id: 2, key: 'model',   label: 'MODEL_SELECT' },
  { id: 3, key: 'project', label: 'PROJECT_INIT' },
];

function stepIndexFromKey(key) {
  const idx = STEPS.findIndex(s => s.key === key);
  return idx < 0 ? 0 : idx;
}

// --- bordered frame shared across steps -------------------------------------
function Frame({ title, subtitle, children, footer }) {
  return (
    <div className="w-full max-w-3xl border border-emerald-500/30 bg-black/70 backdrop-blur-sm shadow-[0_0_40px_rgba(16,185,129,0.08)]">
      <div className="flex items-center justify-between border-b border-emerald-500/20 px-5 py-3">
        <div className="flex items-center gap-3 font-mono">
          <span className="text-emerald-400 text-[10px] tracking-[0.28em]">▸</span>
          <span className="text-slate-300 text-[11px] tracking-[0.28em]">{title}</span>
        </div>
        {subtitle && (
          <span className="font-mono text-[10px] tracking-[0.25em] text-slate-500">{subtitle}</span>
        )}
      </div>
      <div className="px-6 md:px-8 py-7">{children}</div>
      {footer && (
        <div className="border-t border-emerald-500/20 px-5 py-3 flex items-center justify-between gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-2 font-mono">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <span className={`text-[10px] tracking-[0.25em] ${i === step ? 'text-emerald-400' : i < step ? 'text-slate-400' : 'text-slate-700'}`}>
            {String(i).padStart(2, '0')}_{s.label}
          </span>
          {i < STEPS.length - 1 && <span className="text-slate-800">·</span>}
        </div>
      ))}
    </div>
  );
}

function PrimaryBtn({ children, onClick, disabled, loading }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] tracking-[0.28em] border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? <RiLoader4Line size={14} className="animate-spin" /> : null}
      <GlitchText text={typeof children === 'string' ? children : ''} active={hover} />
      {typeof children !== 'string' && children}
      <RiArrowRightLine size={14} className="group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}

function GhostBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3 py-2 font-mono text-[10px] tracking-[0.28em] text-slate-500 hover:text-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <RiArrowLeftLine size={12} />
      {children}
    </button>
  );
}

// ---------- STEP 0: welcome ----------
function WelcomeStep({ onNext }) {
  return (
    <Frame
      title="SESSION/BOOT"
      subtitle="NEW OPERATOR"
      footer={
        <>
          <span className="font-mono text-[10px] text-slate-600 tracking-[0.25em]">~30 SEC · 3 STEPS</span>
          <PrimaryBtn onClick={onNext}>BEGIN_HANDSHAKE</PrimaryBtn>
        </>
      }
    >
      <pre className="font-mono text-emerald-400 text-[10px] leading-tight mb-6 select-none opacity-80">
{`  ╔══════════════════════════════════╗
  ║  > spawn kraken.operator ...     ║
  ║  > checking bindings ......[OK]  ║
  ║  > vision subsystem .......[OK]  ║
  ║  > awaiting credentials ..[PEND] ║
  ╚══════════════════════════════════╝`}
      </pre>

      <h1 className="font-mono text-slate-100 text-[18px] tracking-[0.1em] mb-3">
        WELCOME, OPERATOR.
      </h1>
      <p className="font-mono text-[12px] text-slate-400 leading-relaxed mb-4">
        Kraken runs as a local AI operator: it watches your screen, drives the mouse and keyboard, and executes shell commands — to resolve the task you give it in plain English.
      </p>
      <p className="font-mono text-[12px] text-slate-500 leading-relaxed">
        To deploy, the agent needs access to a reasoning model.
        Supply at least one API key for <span className="text-emerald-400">Gemini</span>, <span className="text-emerald-400">Groq</span>, or <span className="text-emerald-400">OpenRouter</span>.
        Keys are stored locally in <span className="font-mono text-slate-300">backend/config.json</span>.
      </p>
    </Frame>
  );
}

// ---------- STEP 1: keys ----------
function KeysStep({ keys, onAdded, onDeleted, onNext, onBack }) {
  const [provider, setProvider] = useState('gemini');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const add = async () => {
    if (!name.trim() || !secret.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await createKey({ name: name.trim(), provider, secret: secret.trim() });
      onAdded(data);
      setName(''); setSecret(''); setReveal(false);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (k) => {
    try {
      await deleteKey(k.id);
      onDeleted(k.id);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const canContinue = keys.length > 0;

  return (
    <Frame
      title="AUTH/KEYS"
      subtitle={`${keys.length} REGISTERED`}
      footer={
        <>
          <GhostBtn onClick={onBack}>BACK</GhostBtn>
          <PrimaryBtn onClick={onNext} disabled={!canContinue}>SELECT_MODEL</PrimaryBtn>
        </>
      }
    >
      <div className="mb-6">
        <div className="font-mono text-[10px] tracking-[0.28em] text-emerald-400 mb-2">// ADD_CREDENTIAL</div>
        <div className="grid md:grid-cols-[180px_1fr] gap-3 mb-2">
          <div>
            <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">PROVIDER</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 px-3 py-2"
            >
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <option key={id} value={id} className="bg-black">{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">LABEL</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. personal-gemini"
              className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">
            SECRET <span className="text-slate-700">// {PROVIDERS[provider].hint}</span>
          </label>
          <div className="relative">
            <input
              type={reveal ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk-..."
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2 pr-20"
            />
            <button
              onClick={() => setReveal(r => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-emerald-400"
              type="button"
            >
              <RiEyeLine size={13} />
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-2 font-mono text-[10px] text-red-400">! {error}</div>
        )}
        <div className="mt-3 flex justify-end">
          <button
            onClick={add}
            disabled={!name.trim() || !secret.trim() || saving}
            className="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] tracking-[0.28em] border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <RiLoader4Line size={12} className="animate-spin" /> : <RiAddLine size={12} />}
            REGISTER_KEY
          </button>
        </div>
      </div>

      <div className="border-t border-emerald-500/15 pt-5">
        <div className="font-mono text-[10px] tracking-[0.28em] text-emerald-400 mb-2">// REGISTERED</div>
        {keys.length === 0 ? (
          <div className="border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-6 text-center font-mono text-[11px] text-slate-600 tracking-wider">
            [ NO_KEYS · PROVIDE AT LEAST ONE TO CONTINUE ]
          </div>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {keys.map(k => (
              <li key={k.id} className="py-2 flex items-center gap-3 font-mono text-[11px]">
                <RiKey2Line size={12} className="text-emerald-400 shrink-0" />
                <span className="text-slate-200 truncate">{k.name}</span>
                <span className="px-1.5 py-[1px] bg-emerald-500/10 text-emerald-400 text-[9px] tracking-[0.25em]">
                  {k.provider.toUpperCase()}
                </span>
                <span className="text-slate-600 ml-auto text-[10px]">{k.maskedSecret}</span>
                <button onClick={() => del(k)} className="p-1 text-slate-600 hover:text-red-400" title="remove">
                  <RiDeleteBinLine size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Frame>
  );
}

// ---------- STEP 2: model selection ----------
function ModelStep({ keys, onConfigured, onBack }) {
  const availableProviders = useMemo(() => {
    const set = new Set(keys.map(k => k.provider).filter(p => PROVIDERS[p]));
    return Array.from(set);
  }, [keys]);

  const soleProvider = availableProviders.length === 1;

  const [provider, setProvider] = useState(availableProviders[0] || 'gemini');
  const providerCfg = PROVIDERS[provider];
  const defaultModel = providerCfg?.models.find(m => m.recommended)?.id || providerCfg?.models[0]?.id;
  const [model, setModel] = useState(defaultModel);
  const [keyId, setKeyId] = useState(keys.find(k => k.provider === provider)?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // whenever provider changes, reset the model + key selections to sensible defaults
  useEffect(() => {
    const cfg = PROVIDERS[provider];
    const rec = cfg?.models.find(m => m.recommended)?.id || cfg?.models[0]?.id;
    setModel(rec);
    setKeyId(keys.find(k => k.provider === provider)?.id);
  }, [provider, keys]);

  const commit = async () => {
    if (!provider || !model || !keyId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchConfig('llm.activeProvider', provider);
      await patchConfig(`llm.${provider}.activeModel`, model);
      await patchConfig(`llm.${provider}.activeKeyId`, keyId);
      onConfigured();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Frame
      title="MODEL/SELECT"
      subtitle={soleProvider ? 'AUTO · SINGLE PROVIDER' : 'MANUAL'}
      footer={
        <>
          <GhostBtn onClick={onBack}>BACK</GhostBtn>
          <PrimaryBtn onClick={commit} disabled={!provider || !model || !keyId} loading={saving}>
            CONFIRM
          </PrimaryBtn>
        </>
      }
    >
      {/* Provider selector only if multiple keys */}
      {!soleProvider ? (
        <div className="mb-5">
          <div className="font-mono text-[9px] tracking-[0.28em] text-slate-500 mb-2">// PROVIDER</div>
          <div className="grid grid-cols-3 gap-2">
            {availableProviders.map(id => {
              const p = PROVIDERS[id];
              const active = id === provider;
              return (
                <button
                  key={id}
                  onClick={() => setProvider(id)}
                  className={`px-3 py-2 font-mono text-[10px] tracking-[0.24em] border transition-colors text-left
                    ${active
                      ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-800 text-slate-500 hover:border-emerald-500/40 hover:text-slate-300'}`}
                >
                  <span className="block">{p.name}</span>
                  <span className={`block text-[8px] mt-0.5 tracking-widest ${active ? 'text-emerald-500' : 'text-slate-700'}`}>
                    {active ? '> ACTIVE' : 'SELECT'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-5 border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 font-mono text-[11px] text-emerald-300 tracking-wider flex items-center gap-2">
          <RiCheckLine size={14} className="text-emerald-400" />
          ONLY <span className="text-emerald-200">{PROVIDERS[provider]?.name}</span> REGISTERED — USING THAT PROVIDER
        </div>
      )}

      <div className="mb-5">
        <div className="font-mono text-[9px] tracking-[0.28em] text-slate-500 mb-2">// MODEL</div>
        <div className="space-y-1">
          {providerCfg.models.map(m => {
            const active = m.id === model;
            return (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 font-mono text-[11px] border transition-colors text-left
                  ${active
                    ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                    : 'border-zinc-800 text-slate-400 hover:border-emerald-500/40 hover:text-slate-200'}`}
              >
                <span className={`text-[10px] ${active ? 'text-emerald-400' : 'text-slate-700'}`}>{active ? '▸' : '·'}</span>
                <span className="flex-1">{m.name}</span>
                <span className="text-[9px] text-slate-600 tracking-widest">CTX·{m.ctx}</span>
                {m.vision && <RiEyeLine size={11} className={active ? 'text-emerald-400' : 'text-slate-600'} />}
                {m.recommended && (
                  <span className="text-[8px] tracking-[0.25em] px-1.5 py-[1px] border border-emerald-500/30 text-emerald-400">
                    REC
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="font-mono text-[9px] tracking-[0.28em] text-slate-500 mb-2">// KEY</div>
        <div className="space-y-1">
          {keys.filter(k => k.provider === provider).map(k => {
            const active = k.id === keyId;
            return (
              <button
                key={k.id}
                onClick={() => setKeyId(k.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 font-mono text-[11px] border transition-colors text-left
                  ${active
                    ? 'border-emerald-400 bg-emerald-500/10 text-emerald-200'
                    : 'border-zinc-800 text-slate-400 hover:border-emerald-500/40 hover:text-slate-200'}`}
              >
                <RiKey2Line size={12} className={active ? 'text-emerald-400' : 'text-slate-600'} />
                <span className="flex-1 truncate">{k.name}</span>
                <span className="text-[9px] text-slate-600">{k.maskedSecret}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && <div className="mt-3 font-mono text-[10px] text-red-400">! {error}</div>}
    </Frame>
  );
}

// ---------- STEP 3: project init ----------
function ProjectStep({ existingContexts, onCreated, onOpenExisting, onBack }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { data } = await createContext({
        name: name.trim(),
        description: description.trim(),
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const hasExisting = existingContexts.length > 0;

  return (
    <Frame
      title="PROJECT/INIT"
      subtitle={hasExisting ? `${existingContexts.length} EXISTING` : 'NEW'}
      footer={
        <>
          <GhostBtn onClick={onBack}>BACK</GhostBtn>
          <PrimaryBtn onClick={create} disabled={!name.trim()} loading={creating}>
            SPAWN_PROJECT
          </PrimaryBtn>
        </>
      }
    >
      <pre className="font-mono text-emerald-400 text-[10px] leading-tight mb-5 select-none opacity-80">
{`  > credentials .... [ OK ]
  > model routing .. [ OK ]
  > project space .. [ AWAITING ]`}
      </pre>

      <h2 className="font-mono text-slate-100 text-[16px] tracking-[0.12em] mb-2">
        CREATE A PROJECT.
      </h2>
      <p className="font-mono text-[12px] text-slate-400 leading-relaxed mb-5">
        A project groups the screen docs + vector index for <em>one</em> piece of software the agent will operate (e.g. Discord, Figma, a particular terminal workflow). You can add more any time from the dashboard.
      </p>

      <div className="space-y-3">
        <div>
          <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">NAME</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            placeholder="e.g. discord, figma, local-term"
            className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2"
          />
          <p className="font-mono text-[9px] text-slate-600 mt-1 tracking-wider">
            URL slug auto-generated · storage uses an internal id
          </p>
        </div>
        <div>
          <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-1">
            DESCRIPTION <span className="text-slate-700">// optional</span>
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What will the agent do here?"
            className="w-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-3 py-2 resize-none"
          />
        </div>
      </div>

      {error && <div className="mt-3 font-mono text-[10px] text-red-400">! {error}</div>}

      {hasExisting && (
        <div className="mt-5 border-t border-emerald-500/15 pt-4">
          <div className="font-mono text-[10px] tracking-[0.28em] text-slate-500 mb-2">
            // OR OPEN AN EXISTING PROJECT
          </div>
          <ul className="space-y-1">
            {existingContexts.slice(0, 4).map(c => (
              <li key={c.id}>
                <button
                  onClick={() => onOpenExisting(c)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] border border-zinc-800 hover:border-emerald-500/40 text-slate-400 hover:text-emerald-200 text-left transition-colors"
                >
                  <RiFolderLine size={12} className="text-emerald-500/60" />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-[9px] text-slate-600">{c.slug}</span>
                  <RiArrowRightLine size={12} className="text-slate-600" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Frame>
  );
}

// ---------- Main page ----------
export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedStep = searchParams.get('step');
  const [step, setStep] = useState(() => stepIndexFromKey(requestedStep));
  const [keys, setKeys] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Preload everything we need from the backend so each step opens with
  // real state (prior keys, prior contexts) instead of starting from scratch.
  useEffect(() => {
    Promise.all([
      getKeys().catch(() => ({ data: { keys: [] } })),
      listContexts().catch(() => ({ data: { contexts: [] } })),
    ])
      .then(([k, c]) => {
        setKeys(k.data.keys || []);
        setContexts(c.data.contexts || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const openContext = (ctx) => {
    markOnboarded();
    navigate(`/c/${ctx.slug}`);
  };

  const skip = () => {
    // Escape hatch — send user to whatever dashboard they'd normally see.
    markOnboarded();
    if (contexts.length === 1) navigate(`/c/${contexts[0].slug}`);
    else navigate('/dashboard');
  };

  return (
    <div className="relative min-h-screen bg-black text-slate-200 overflow-hidden">
      <AsciiRain />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_30%,rgba(0,0,0,0.92)_100%)]" />

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-zinc-900">
          <button
            onClick={() => navigate('/')}
            className="font-mono text-[13px] tracking-[0.1em] text-slate-300 hover:text-emerald-400 transition-colors"
          >
            kraken<span className="text-emerald-400">.assist</span>
          </button>

          <div className="hidden md:block">
            <StepDots step={step} />
          </div>

          <button
            onClick={skip}
            className="font-mono text-[10px] tracking-[0.28em] text-slate-600 hover:text-slate-300 transition-colors"
          >
            SKIP <RiCloseLine size={11} className="inline -mt-0.5" />
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-10">
          {loading ? (
            <div className="font-mono text-[11px] text-slate-500 tracking-[0.28em]">
              <RiLoader4Line size={14} className="inline animate-spin mr-2" /> LOADING…
            </div>
          ) : (
            <>
              {step === 0 && (
                <WelcomeStep onNext={() => setStep(1)} />
              )}
              {step === 1 && (
                <KeysStep
                  keys={keys}
                  onAdded={(k) => setKeys(ks => [...ks, k])}
                  onDeleted={(id) => setKeys(ks => ks.filter(k => k.id !== id))}
                  onNext={() => setStep(2)}
                  onBack={() => setStep(0)}
                />
              )}
              {step === 2 && (
                <ModelStep
                  keys={keys}
                  onConfigured={() => setStep(3)}
                  onBack={() => setStep(1)}
                />
              )}
              {step === 3 && (
                <ProjectStep
                  existingContexts={contexts}
                  onCreated={openContext}
                  onOpenExisting={openContext}
                  onBack={() => setStep(2)}
                />
              )}
            </>
          )}
        </main>

        <footer className="py-3 text-center font-mono text-[9px] tracking-[0.3em] text-slate-700 border-t border-zinc-900">
          SESSION · LOCAL · NO TELEMETRY
        </footer>
      </div>
    </div>
  );
}
