import { useState } from 'react';
import {
  RiCloseLine, RiCpuLine, RiCheckLine, RiArrowDownSLine,
  RiKey2Line, RiSettingsLine, RiDatabase2Line, RiRobot2Line,
  RiBrainLine, RiServerLine, RiRefreshLine, RiEyeLine,
  RiSparklingLine, RiKeyLine,
} from 'react-icons/ri';

import EditableField from '../ui/EditableField.jsx';
import KeyManager from './KeyManager.jsx';
import api from '../../services/api.js';

// Model catalogs (client-side static, since these are the available options
// we support — not something the user edits). Must stay in sync with
// agent/llm.service.js PROVIDERS catalog; the agent is the source of truth
// for which model IDs actually work.
const PROVIDERS = {
  gemini: {
    name: 'GOOGLE GEMINI',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', ctx: '1M', out: '65K', vision: true },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', ctx: '1M', out: '65K', vision: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', ctx: '1M', out: '8K', vision: true },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', ctx: '1M', out: '65K', vision: true },
    ],
  },
  groq: {
    name: 'GROQ',
    models: [
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', ctx: '128K', out: '8K', vision: true },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', ctx: '128K', out: '32K', vision: false },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', ctx: '128K', out: '8K', vision: false },
      { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', ctx: '128K', out: '32K', vision: false },
    ],
  },
  openrouter: {
    name: 'OPENROUTER',
    models: [
      { id: 'qwen/qwen2.5-vl-72b-instruct', name: 'Qwen2.5-VL 72B (paid)', ctx: '128K', out: '8K', vision: true },
      { id: 'qwen/qwen2.5-vl-32b-instruct', name: 'Qwen2.5-VL 32B (paid)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B MoE (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron Nano 12B VL (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-12b-it:free', name: 'Gemma 3 12B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-4b-it:free', name: 'Gemma 3 4B (free)', ctx: '128K', out: '8K', vision: true },
    ],
  },
  claude: {
    name: 'ANTHROPIC CLAUDE',
    models: [
      { id: 'claude-opus-4-7',           name: 'Claude Opus 4.7',   ctx: '1M',   out: '64K', vision: true },
      { id: 'claude-sonnet-4-6',         name: 'Claude Sonnet 4.6', ctx: '1M',   out: '64K', vision: true },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5',  ctx: '200K', out: '64K', vision: true },
    ],
  },
};

// ---------- Collapsible section ----------

function Section({ icon, title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-900">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-emerald-500/[0.04] transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-emerald-500/70">{icon}</span>
        <span className="font-mono text-[10px] tracking-[0.28em] text-slate-400 flex-1">{title}</span>
        {badge && (
          <span className="px-1.5 py-[1px] font-mono text-[8px] tracking-[0.25em] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            {String(badge).toUpperCase()}
          </span>
        )}
        <RiArrowDownSLine
          size={14}
          className={`text-emerald-500/50 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-1 gap-2">
      <span className="font-mono text-[9px] tracking-[0.25em] text-slate-500">{label}</span>
      <span className={`text-[11px] text-slate-300 truncate ${mono ? 'font-mono' : 'font-mono'}`}>{value ?? '—'}</span>
    </div>
  );
}

// ---------- Main drawer ----------

export default function LlmDrawer({
  open, onClose,
  appConfig,         // full /config payload
  systemInfo,
  chromaStatus,
  ragInfo,
  keys,              // all stored API keys
  onReloadConfig,    // refetch /config
  onReloadKeys,      // refetch /keys
  onIngest,
}) {
  const [expandedProvider, setExpandedProvider] = useState(null);

  if (!open) return null;

  const saveConfig = async (path, value) => {
    await api.patch('/config', { path, value });
    onReloadConfig();
  };

  // Map active key IDs → the slots they're assigned to (for KeyManager "Used by")
  const activeAssignments = {};
  for (const provider of Object.keys(PROVIDERS)) {
    const kid = appConfig?.llm?.[provider]?.activeKeyId;
    if (kid) {
      activeAssignments[kid] = activeAssignments[kid] || [];
      activeAssignments[kid].push(`llm.${provider}`);
    }
  }

  const activeProvider = appConfig?.llm?.activeProvider || 'gemini';

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 animate-fade-in" onClick={onClose} />

      <div className="fixed top-0 right-0 bottom-0 w-[380px] bg-black border-l border-emerald-500/30 z-50 flex flex-col animate-slide-in-right shadow-[0_0_60px_rgba(16,185,129,0.08)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/20">
          <div className="flex items-center gap-2">
            <RiSettingsLine size={14} className="text-emerald-400" />
            <span className="font-mono text-[11px] tracking-[0.28em] text-slate-300">CONFIG</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-emerald-400 transition-colors">
            <RiCloseLine size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ===== LLM Providers ===== */}
          <Section icon={<RiCpuLine size={13} />} title="LLM_PROVIDERS" badge={activeProvider} defaultOpen>
            <div className="mb-2">
              <div className="font-mono text-[9px] tracking-[0.25em] text-slate-500 mb-1">// ACTIVE PROVIDER</div>
              <div className="flex gap-1">
                {Object.keys(PROVIDERS).map((pid) => (
                  <button
                    key={pid}
                    className={`flex-1 px-2 py-1 font-mono text-[9px] tracking-[0.25em] border transition-colors
                      ${pid === activeProvider
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400'
                        : 'bg-black text-slate-500 border-zinc-800 hover:border-emerald-500/40 hover:text-slate-300'}`}
                    onClick={() => saveConfig('llm.activeProvider', pid)}
                  >
                    {PROVIDERS[pid].name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {Object.entries(PROVIDERS).map(([providerId, provider]) => {
                const isActive = providerId === activeProvider;
                const isExpanded = expandedProvider === providerId;
                const providerCfg = appConfig?.llm?.[providerId] || {};
                const activeModel = providerCfg.activeModel;
                const activeKeyId = providerCfg.activeKeyId;
                const modelInfo = provider.models.find(m => m.id === activeModel) || provider.models[0];
                const providerKeys = keys.filter(k => k.provider === providerId);
                const selectedKey = providerKeys.find(k => k.id === activeKeyId);

                return (
                  <div key={providerId} className="border border-zinc-900 overflow-hidden">
                    <button
                      className={`w-full text-left p-2.5 transition-colors ${isActive ? 'bg-emerald-500/[0.04]' : 'bg-black hover:bg-emerald-500/[0.02]'}`}
                      onClick={() => setExpandedProvider(isExpanded ? null : providerId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] tracking-wider text-slate-200">{provider.name}</span>
                          {isActive && (
                            <span className="px-1.5 py-[1px] font-mono text-[8px] tracking-[0.25em] border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <RiArrowDownSLine size={14} className={`text-emerald-500/60 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <div className="font-mono text-[10px] text-slate-500 mt-0.5">{modelInfo?.name}</div>
                      <div className="font-mono text-[9px] text-slate-600 mt-0.5 flex items-center gap-2 tracking-wider">
                        <span>CTX·{modelInfo?.ctx} · OUT·{modelInfo?.out}</span>
                        {modelInfo?.vision && <span className="text-emerald-400 flex items-center gap-0.5"><RiEyeLine size={10} /> VISION</span>}
                        {selectedKey ? (
                          <span className="text-emerald-400 flex items-center gap-0.5">
                            <RiKey2Line size={10} /> {selectedKey.name}
                          </span>
                        ) : (
                          <span className="text-amber-400">NO_KEY</span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-900">
                        {/* Models */}
                        <div className="py-1">
                          <div className="px-3 py-1 font-mono text-[8px] tracking-[0.28em] text-slate-600">// MODEL</div>
                          {provider.models.map((model) => {
                            const isSelected = model.id === activeModel;
                            return (
                              <div
                                key={model.id}
                                className={`flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] cursor-pointer transition-colors
                                  ${isSelected ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-emerald-500/[0.04] hover:text-slate-200'}`}
                                onClick={() => saveConfig(`llm.${providerId}.activeModel`, model.id)}
                              >
                                {isSelected && <RiCheckLine size={11} className="text-emerald-400 shrink-0" />}
                                <span className={`flex-1 ${!isSelected ? 'ml-4' : ''}`}>{model.name}</span>
                                <span className="text-[8px] text-slate-600 tracking-widest">{model.ctx}</span>
                                {model.vision && <RiEyeLine size={10} className="text-emerald-500/70" />}
                              </div>
                            );
                          })}
                        </div>

                        {/* Key selector */}
                        <div className="border-t border-zinc-900 py-1.5 px-2">
                          <div className="px-1 font-mono text-[8px] tracking-[0.28em] text-slate-600 mb-1 flex items-center gap-1">
                            <RiKey2Line size={10} /> // ACTIVE KEY
                          </div>
                          {providerKeys.length === 0 ? (
                            <div className="px-1 py-1 font-mono text-[9px] text-slate-600 italic tracking-wider">
                              NO {provider.name} KEYS · ADD ONE BELOW
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <div
                                className={`flex items-center gap-2 px-2 py-1 font-mono text-[10px] cursor-pointer transition-colors
                                  ${!activeKeyId ? 'bg-zinc-900 text-slate-400' : 'text-slate-500 hover:bg-emerald-500/[0.04]'}`}
                                onClick={() => saveConfig(`llm.${providerId}.activeKeyId`, null)}
                              >
                                {!activeKeyId && <RiCheckLine size={11} className="text-slate-400 shrink-0" />}
                                <span className={`italic ${activeKeyId ? 'ml-4' : ''}`}>none</span>
                              </div>
                              {providerKeys.map((k) => {
                                const isSel = k.id === activeKeyId;
                                return (
                                  <div
                                    key={k.id}
                                    className={`flex items-center gap-2 px-2 py-1 font-mono text-[10px] cursor-pointer transition-colors
                                      ${isSel ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-emerald-500/[0.04]'}`}
                                    onClick={() => saveConfig(`llm.${providerId}.activeKeyId`, k.id)}
                                  >
                                    {isSel && <RiCheckLine size={11} className="text-emerald-400 shrink-0" />}
                                    <span className={`flex-1 truncate ${!isSel ? 'ml-4' : ''}`}>{k.name}</span>
                                    <span className="text-[8px] text-slate-600">{k.maskedSecret}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* ===== API Keys ===== */}
          <Section icon={<RiKeyLine size={13} />} title="API_KEYS" badge={keys.length > 0 ? String(keys.length) : null}>
            <KeyManager
              keys={keys}
              activeAssignments={activeAssignments}
              onReload={onReloadKeys}
            />
          </Section>

          {/* ===== ChromaDB ===== */}
          <Section
            icon={<RiDatabase2Line size={13} />}
            title="CHROMADB"
            badge={chromaStatus === 'connected' ? 'OK' : null}
          >
            <EditableField
              label="URL"
              value={appConfig?.chromadb?.url || ''}
              onSave={(v) => saveConfig('chromadb.url', v)}
              type="url"
              mono
              placeholder="http://localhost:8000"
            />
            <EditableField
              label="COLLECTION"
              value={appConfig?.chromadb?.collection || ''}
              onSave={(v) => saveConfig('chromadb.collection', v)}
              mono
            />
            <InfoRow
              label="STATUS"
              value={
                <span className={chromaStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>
                  {(chromaStatus || 'unknown').toUpperCase()}
                </span>
              }
            />
            <div className="mt-2 px-2 py-1.5 border border-zinc-900 font-mono text-[9px] text-slate-600 tracking-wider">
              START WITH: <span className="text-slate-400">chroma run --port 8000</span>
            </div>
          </Section>

          {/* ===== RAG & Embeddings ===== */}
          <Section
            icon={<RiBrainLine size={13} />}
            title="RAG_EMBEDDINGS"
            badge={ragInfo?.docsOnDisk > 0 ? `${ragInfo.docsIndexed}/${ragInfo.docsOnDisk}` : null}
          >
            <EditableField
              label="MODEL"
              value={appConfig?.embeddings?.model || ''}
              onSave={(v) => saveConfig('embeddings.model', v)}
              mono
            />
            <EditableField
              label="DIMENSIONS"
              value={appConfig?.embeddings?.dimensions ?? 384}
              onSave={(v) => saveConfig('embeddings.dimensions', v)}
              type="number"
            />
            <InfoRow label="ON_DISK"     value={ragInfo?.docsOnDisk ?? 0} />
            <InfoRow label="INDEXED"     value={<span className="text-emerald-400">{ragInfo?.docsIndexed ?? 0}</span>} />
            <InfoRow label="STALE"       value={<span className={ragInfo?.docsStale > 0 ? 'text-amber-400' : 'text-slate-500'}>{ragInfo?.docsStale ?? 0}</span>} />
            <InfoRow label="NOT_INDEXED" value={<span className={ragInfo?.docsNotIndexed > 0 ? 'text-slate-400' : 'text-slate-500'}>{ragInfo?.docsNotIndexed ?? 0}</span>} />
            <div className="mt-2">
              <button
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.28em]
                  border border-emerald-500/40 text-emerald-300
                  hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 transition-colors"
                onClick={onIngest}
              >
                <RiRefreshLine size={12} /> RE_INDEX_SCREEN_DOCS
              </button>
            </div>
          </Section>

          {/* ===== Agent ===== */}
          <Section icon={<RiRobot2Line size={13} />} title="AGENT">
            <EditableField
              label="MAX_STEPS"
              value={appConfig?.agent?.maxSteps ?? 30}
              onSave={(v) => saveConfig('agent.maxSteps', v)}
              type="number"
            />
            <EditableField
              label="MAX_RETRIES"
              value={appConfig?.agent?.maxRetries ?? 3}
              onSave={(v) => saveConfig('agent.maxRetries', v)}
              type="number"
            />
            <EditableField
              label="ACTION_DELAY_MS"
              value={appConfig?.agent?.postActionDelay ?? 400}
              onSave={(v) => saveConfig('agent.postActionDelay', v)}
              type="number"
            />
            <div className="mt-2 px-2 py-1.5 border border-zinc-900 font-mono text-[9px] text-slate-500 leading-relaxed tracking-wider">
              <RiSparklingLine size={10} className="inline text-emerald-400 mr-1" />
              VISION REQUIRED PER STEP. AGENT ROTATES KEYS → MODELS → PROVIDERS WHILE KEEPING VISION. NO BLIND MODE.
            </div>
          </Section>

          {/* ===== System / MCP ===== */}
          <Section icon={<RiServerLine size={13} />} title="SYSTEM_MCP">
            <InfoRow label="PLATFORM"   value={`${systemInfo?.platform || '—'} ${systemInfo?.arch || ''}`.trim()} />
            <InfoRow label="RELEASE"    value={systemInfo?.release || '—'} mono />
            <InfoRow label="HOSTNAME"   value={systemInfo?.hostname || '—'} mono />
            <InfoRow label="CPUS"       value={systemInfo?.cpus || '—'} />
            <InfoRow label="MEMORY"     value={systemInfo?.totalMemoryGB ? `${systemInfo.totalMemoryGB} GB` : '—'} />
            <InfoRow label="SESSION"    value={systemInfo?.sessionType || '—'} />
            <InfoRow label="DISPLAY_X11" value={systemInfo?.display || '—'} mono />
            <InfoRow label="WAYLAND"    value={systemInfo?.waylandDisplay || '—'} mono />
            <InfoRow label="XAUTHORITY" value={systemInfo?.xauthority || '—'} mono />
            <InfoRow label="SHELL"      value={systemInfo?.shell || '—'} mono />
            <InfoRow label="NODE"       value={systemInfo?.nodeVersion || '—'} mono />
            <InfoRow label="BACKEND"    value="127.0.0.1:3000" mono />
            <InfoRow label="MCP_TOOLS"  value={systemInfo?.mcpTools || 21} />
            <InfoRow label="SCREENSHOT" value={systemInfo?.screenshotTool || 'gnome-screenshot'} />
            <InfoRow label="INPUT"      value="nut-js (X11)" />
            <InfoRow label="CAPTURE"    value="uiohook-napi (X11)" />
            <div className="mt-2 px-2 py-1.5 border border-zinc-900 font-mono text-[9px] text-slate-600 tracking-wider leading-relaxed">
              DETECTED FROM RUNNING BACKEND ENVIRONMENT · READ-ONLY
            </div>
          </Section>
        </div>

        <div className="px-4 py-2 border-t border-emerald-500/20 font-mono text-[9px] tracking-wider text-slate-600">
          CHANGES SAVED TO <span className="text-emerald-500/70">backend/config.json</span>
        </div>
      </div>
    </>
  );
}
