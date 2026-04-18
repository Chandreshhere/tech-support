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
    name: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', ctx: '1M', out: '65K', vision: true },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', ctx: '1M', out: '65K', vision: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', ctx: '1M', out: '8K', vision: true },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', ctx: '1M', out: '65K', vision: true },
    ],
  },
  groq: {
    name: 'Groq',
    models: [
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', ctx: '128K', out: '8K', vision: true },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', ctx: '128K', out: '32K', vision: false },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', ctx: '128K', out: '8K', vision: false },
      { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', ctx: '128K', out: '32K', vision: false },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    models: [
      // Paid — recommended primary. SOTA GUI grounding, absolute pixel coords.
      { id: 'qwen/qwen2.5-vl-72b-instruct', name: 'Qwen2.5-VL 72B (paid)', ctx: '128K', out: '8K', vision: true },
      { id: 'qwen/qwen2.5-vl-32b-instruct', name: 'Qwen2.5-VL 32B (paid)', ctx: '128K', out: '8K', vision: true },
      // Free fallbacks — availability fluctuates
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B MoE (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron Nano 12B VL (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-12b-it:free', name: 'Gemma 3 12B (free)', ctx: '128K', out: '8K', vision: true },
      { id: 'google/gemma-3-4b-it:free', name: 'Gemma 3 4B (free)', ctx: '128K', out: '8K', vision: true },
    ],
  },
};

// ---------- Collapsible section ----------

function Section({ icon, title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-800/60">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-800/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="text-slate-500">{icon}</span>
        <span className="text-[12px] font-semibold uppercase tracking-wider text-slate-400 flex-1">{title}</span>
        {badge && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-500/15 text-emerald-400 tracking-wider">
            {badge}
          </span>
        )}
        <RiArrowDownSLine
          size={14}
          className={`text-slate-600 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[11px] text-slate-300 truncate ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
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
  onReloadAll,       // refetch everything
  onIngest,
}) {
  const [expandedProvider, setExpandedProvider] = useState(null);

  if (!open) return null;

  // Save a config path (dot-path + value)
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
      <div className="fixed inset-0 bg-black/40 z-40 animate-fade-in" onClick={onClose} />

      <div className="fixed top-0 right-0 bottom-0 w-[360px] bg-zinc-900 border-l border-zinc-700 z-50 flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <RiSettingsLine size={16} className="text-violet-400" />
            Configuration
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-slate-400 hover:text-slate-200">
            <RiCloseLine size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ===== LLM Providers ===== */}
          <Section icon={<RiCpuLine size={14} />} title="LLM Providers" badge={activeProvider} defaultOpen>
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Active Provider</div>
              <div className="flex gap-1">
                {Object.keys(PROVIDERS).map((pid) => (
                  <button
                    key={pid}
                    className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors
                      ${pid === activeProvider
                        ? 'bg-violet-600/20 text-violet-300 border border-violet-500/40'
                        : 'bg-zinc-800 text-slate-400 border border-zinc-700 hover:bg-zinc-700'}`}
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
                  <div key={providerId} className="rounded-lg border border-zinc-800 overflow-hidden">
                    <button
                      className={`w-full text-left p-2.5 transition-colors ${isActive ? 'bg-zinc-800/80' : 'bg-zinc-900 hover:bg-zinc-800/50'}`}
                      onClick={() => setExpandedProvider(isExpanded ? null : providerId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-slate-200">{provider.name}</span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-violet-500/20 text-violet-300 tracking-wider">
                              Active
                            </span>
                          )}
                        </div>
                        <RiArrowDownSLine size={14} className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{modelInfo?.name}</div>
                      <div className="text-[10px] text-slate-600 mt-0.5 flex items-center gap-2">
                        <span>Ctx: {modelInfo?.ctx} · Out: {modelInfo?.out}</span>
                        {modelInfo?.vision && <span className="text-violet-400 flex items-center gap-0.5"><RiEyeLine size={10} /> Vision</span>}
                        {selectedKey ? (
                          <span className="text-emerald-400 flex items-center gap-0.5">
                            <RiKey2Line size={10} /> {selectedKey.name}
                          </span>
                        ) : (
                          <span className="text-amber-400">No key</span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-zinc-800">
                        {/* Models */}
                        <div className="py-1">
                          <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-slate-600">Model</div>
                          {provider.models.map((model) => {
                            const isSelected = model.id === activeModel;
                            return (
                              <div
                                key={model.id}
                                className={`flex items-center gap-2 px-3 py-1.5 text-[11px] cursor-pointer
                                  ${isSelected ? 'bg-violet-500/10 text-violet-300' : 'text-slate-400 hover:bg-zinc-800/60'}`}
                                onClick={() => saveConfig(`llm.${providerId}.activeModel`, model.id)}
                              >
                                {isSelected && <RiCheckLine size={11} className="text-violet-400 shrink-0" />}
                                <span className={`flex-1 ${!isSelected ? 'ml-4' : ''}`}>{model.name}</span>
                                <span className="text-[9px] text-slate-600">{model.ctx}</span>
                                {model.vision && <RiEyeLine size={10} className="text-violet-500" />}
                              </div>
                            );
                          })}
                        </div>

                        {/* Key selector */}
                        <div className="border-t border-zinc-800 py-1.5 px-2">
                          <div className="px-1 text-[9px] uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1">
                            <RiKey2Line size={10} /> Active Key
                          </div>
                          {providerKeys.length === 0 ? (
                            <div className="px-1 py-1 text-[10px] text-slate-500 italic">
                              No {provider.name} keys saved. Add one in "API Keys" below.
                            </div>
                          ) : (
                            <div className="space-y-0.5">
                              <div
                                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer
                                  ${!activeKeyId ? 'bg-zinc-800 text-slate-400' : 'text-slate-500 hover:bg-zinc-800/60'}`}
                                onClick={() => saveConfig(`llm.${providerId}.activeKeyId`, null)}
                              >
                                {!activeKeyId && <RiCheckLine size={11} className="text-slate-400 shrink-0" />}
                                <span className={`italic ${activeKeyId ? 'ml-4' : ''}`}>None</span>
                              </div>
                              {providerKeys.map((k) => {
                                const isSel = k.id === activeKeyId;
                                return (
                                  <div
                                    key={k.id}
                                    className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] cursor-pointer
                                      ${isSel ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-zinc-800/60'}`}
                                    onClick={() => saveConfig(`llm.${providerId}.activeKeyId`, k.id)}
                                  >
                                    {isSel && <RiCheckLine size={11} className="text-emerald-400 shrink-0" />}
                                    <span className={`flex-1 truncate ${!isSel ? 'ml-4' : ''}`}>{k.name}</span>
                                    <span className="text-[9px] text-slate-600 font-mono">{k.maskedSecret}</span>
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
          <Section icon={<RiKeyLine size={14} />} title="API Keys" badge={keys.length > 0 ? String(keys.length) : null}>
            <KeyManager
              keys={keys}
              activeAssignments={activeAssignments}
              onReload={onReloadKeys}
            />
          </Section>

          {/* ===== ChromaDB ===== */}
          <Section
            icon={<RiDatabase2Line size={14} />}
            title="ChromaDB"
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
              label="Collection"
              value={appConfig?.chromadb?.collection || ''}
              onSave={(v) => saveConfig('chromadb.collection', v)}
              mono
            />
            <InfoRow
              label="Status"
              value={
                <span className={chromaStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>
                  {chromaStatus || 'unknown'}
                </span>
              }
            />
            <div className="mt-2 px-1 py-1.5 rounded bg-zinc-800/50 text-[10px] text-slate-500">
              Start with: <span className="text-slate-400 font-mono">chroma run --port 8000</span>
            </div>
          </Section>

          {/* ===== RAG & Embeddings ===== */}
          <Section
            icon={<RiBrainLine size={14} />}
            title="RAG & Embeddings"
            badge={ragInfo?.docsOnDisk > 0 ? `${ragInfo.docsIndexed}/${ragInfo.docsOnDisk}` : null}
          >
            <EditableField
              label="Embedding Model"
              value={appConfig?.embeddings?.model || ''}
              onSave={(v) => saveConfig('embeddings.model', v)}
              mono
            />
            <EditableField
              label="Dimensions"
              value={appConfig?.embeddings?.dimensions ?? 384}
              onSave={(v) => saveConfig('embeddings.dimensions', v)}
              type="number"
            />
            <InfoRow label="Files on disk" value={ragInfo?.docsOnDisk ?? 0} />
            <InfoRow label="Indexed" value={<span className="text-emerald-400">{ragInfo?.docsIndexed ?? 0}</span>} />
            <InfoRow label="Stale" value={<span className={ragInfo?.docsStale > 0 ? 'text-amber-400' : 'text-slate-500'}>{ragInfo?.docsStale ?? 0}</span>} />
            <InfoRow label="Not indexed" value={<span className={ragInfo?.docsNotIndexed > 0 ? 'text-slate-400' : 'text-slate-500'}>{ragInfo?.docsNotIndexed ?? 0}</span>} />
            <div className="mt-2">
              <button
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium
                  bg-violet-600/15 text-violet-300 border border-violet-500/25
                  hover:bg-violet-600/25 hover:border-violet-500/40 transition-colors"
                onClick={onIngest}
              >
                <RiRefreshLine size={12} /> Re-index Screen Docs
              </button>
            </div>
          </Section>

          {/* ===== Agent ===== */}
          <Section icon={<RiRobot2Line size={14} />} title="Agent">
            <EditableField
              label="Max Steps"
              value={appConfig?.agent?.maxSteps ?? 30}
              onSave={(v) => saveConfig('agent.maxSteps', v)}
              type="number"
            />
            <EditableField
              label="Max Retries"
              value={appConfig?.agent?.maxRetries ?? 3}
              onSave={(v) => saveConfig('agent.maxRetries', v)}
              type="number"
            />
            <EditableField
              label="Action Delay (ms)"
              value={appConfig?.agent?.postActionDelay ?? 400}
              onSave={(v) => saveConfig('agent.postActionDelay', v)}
              type="number"
            />
            <div className="mt-2 px-1 py-1.5 rounded bg-zinc-800/50 text-[10px] text-slate-500">
              <RiSparklingLine size={10} className="inline text-violet-400 mr-1" />
              Vision is required for every step. The agent rotates keys within the active model, then across models on the same provider, then to other providers — always keeping vision. No blind mode.
            </div>
          </Section>

          {/* ===== System / MCP (read-only — detected at runtime) ===== */}
          <Section icon={<RiServerLine size={14} />} title="System & MCP">
            <InfoRow label="Platform" value={`${systemInfo?.platform || '—'} ${systemInfo?.arch || ''}`.trim()} />
            <InfoRow label="Release" value={systemInfo?.release || '—'} mono />
            <InfoRow label="Hostname" value={systemInfo?.hostname || '—'} mono />
            <InfoRow label="CPUs" value={systemInfo?.cpus || '—'} />
            <InfoRow label="Memory" value={systemInfo?.totalMemoryGB ? `${systemInfo.totalMemoryGB} GB` : '—'} />
            <InfoRow label="Session" value={systemInfo?.sessionType || '—'} />
            <InfoRow label="Display (X11)" value={systemInfo?.display || '—'} mono />
            <InfoRow label="Wayland" value={systemInfo?.waylandDisplay || '—'} mono />
            <InfoRow label="XAuthority" value={systemInfo?.xauthority || '—'} mono />
            <InfoRow label="Shell" value={systemInfo?.shell || '—'} mono />
            <InfoRow label="Node" value={systemInfo?.nodeVersion || '—'} mono />
            <InfoRow label="Backend" value="http://127.0.0.1:3000" mono />
            <InfoRow label="MCP Tools" value={systemInfo?.mcpTools || 21} />
            <InfoRow label="Screenshot" value={systemInfo?.screenshotTool || 'gnome-screenshot'} />
            <InfoRow label="Input" value="nut-js (X11)" />
            <InfoRow label="Capture" value="uiohook-napi (X11)" />
            <div className="mt-2 px-1 py-1.5 rounded bg-zinc-800/50 text-[10px] text-slate-500">
              Detected from the running backend process environment. Read-only.
            </div>
          </Section>
        </div>

        <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-slate-600">
          Changes are saved to <span className="font-mono">backend/config.json</span>
        </div>
      </div>
    </>
  );
}
