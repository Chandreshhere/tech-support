import { useState, useReducer, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Panel, Group, Separator } from 'react-resizable-panels';
import api, { ctxApi, getContext } from '../services/api.js';

import Toolbar from '../components/toolbar/Toolbar.jsx';
import Sidebar from '../components/sidebar/Sidebar.jsx';
import LlmDrawer from '../components/drawer/LlmDrawer.jsx';
import TabBar from '../components/panels/TabBar.jsx';
import DocViewer from '../components/panels/DocViewer.jsx';
import DocEditor from '../components/panels/DocEditor.jsx';
import PromptPanel from '../components/panels/PromptPanel.jsx';
import MetadataPanel from '../components/panels/MetadataPanel.jsx';

// --- Reducer ---
const initialState = {
  screenDocs: [],
  openTabs: [],
  activeDoc: null,
  mode: 'view',
  docContents: {},
  editDraft: '',
  createDraft: { name: '', content: '' },
  dirtyDocs: [],
  agentLog: [],
  agentRunning: false,
  appConfig: {},    // full /config payload
  apiKeys: [],      // array of saved API keys
  systemInfo: {},
  chromaInfo: {},
  ragInfo: {},
};

function reducer(state, action) {
  switch (action.type) {
    case 'SELECT_DOC': {
      const name = action.name;
      const openTabs = state.openTabs.includes(name) ? state.openTabs : [...state.openTabs, name];
      return { ...state, activeDoc: name, openTabs, mode: 'view' };
    }
    case 'CLOSE_TAB': {
      const openTabs = state.openTabs.filter(t => t !== action.name);
      const activeDoc = state.activeDoc === action.name
        ? (openTabs[openTabs.length - 1] || null) : state.activeDoc;
      return { ...state, openTabs, activeDoc,
        mode: activeDoc ? 'view' : 'view',
        dirtyDocs: state.dirtyDocs.filter(d => d !== action.name) };
    }
    case 'SET_DOC_CONTENT':
      return { ...state, docContents: { ...state.docContents, [action.name]: action.content } };
    case 'START_EDIT':
      return { ...state, mode: 'edit', editDraft: state.docContents[state.activeDoc] || '' };
    case 'UPDATE_DRAFT':
      return { ...state, editDraft: action.content,
        dirtyDocs: state.dirtyDocs.includes(state.activeDoc) ? state.dirtyDocs : [...state.dirtyDocs, state.activeDoc] };
    case 'SAVE_EDIT':
      return { ...state, mode: 'view',
        docContents: { ...state.docContents, [state.activeDoc]: state.editDraft },
        dirtyDocs: state.dirtyDocs.filter(d => d !== state.activeDoc) };
    case 'REMOVE_DOC': {
      const name = action.name;
      const openTabs = state.openTabs.filter(t => t !== name);
      const activeDoc = state.activeDoc === name ? (openTabs[openTabs.length - 1] || null) : state.activeDoc;
      const { [name]: _, ...rest } = state.docContents;
      return { ...state,
        screenDocs: state.screenDocs.filter(d => d.name !== name),
        openTabs, activeDoc, docContents: rest, mode: activeDoc ? 'view' : 'view',
        dirtyDocs: state.dirtyDocs.filter(d => d !== name) };
    }
    case 'ADD_DOC': {
      // The doc returned from POST has { name, status }
      const newDoc = { name: action.name, status: action.status || 'not-indexed', updated_at: Date.now(), indexed_at: null };
      return { ...state,
        screenDocs: [...state.screenDocs, newDoc].sort((a, b) => a.name.localeCompare(b.name)),
        docContents: { ...state.docContents, [action.name]: action.content },
        openTabs: [...state.openTabs, action.name],
        activeDoc: action.name,
        mode: 'view' };
    }
    case 'UPDATE_DOC_STATUS': {
      // Update status on an existing doc
      return { ...state,
        screenDocs: state.screenDocs.map(d =>
          d.name === action.name ? { ...d, status: action.status, updated_at: action.updated_at || d.updated_at } : d) };
    }
    case 'REPLACE_SCREEN_DOCS':
      return { ...state, screenDocs: action.docs };
    case 'START_CREATE':
      return { ...state, mode: 'create', createDraft: { name: '', content: '' } };
    case 'UPDATE_CREATE_DRAFT':
      return { ...state, createDraft: { ...state.createDraft, ...action.fields } };
    case 'CANCEL_MODE':
      return { ...state, mode: 'view', dirtyDocs: state.dirtyDocs.filter(d => d !== state.activeDoc) };
    case 'OPEN_METADATA':
      return { ...state, mode: 'metadata' };
    case 'AGENT_LOG':
      return { ...state, agentLog: [...state.agentLog, action.entry] };
    case 'AGENT_RUNNING':
      return { ...state, agentRunning: action.running };
    case 'SET_APP_CONFIG':
      return { ...state, appConfig: action.config };
    case 'SET_API_KEYS':
      return { ...state, apiKeys: action.keys };
    case 'SET_SYSTEM_INFO':
      return { ...state, systemInfo: action.info };
    case 'SET_CHROMA_INFO':
      return { ...state, chromaInfo: action.info };
    case 'SET_RAG_INFO':
      return { ...state, ragInfo: action.info };
    default:
      return state;
  }
}

// Format a routing event (rate-limit, key rotation, provider switch)
// produced by llm.service.invoke() into a one-line log entry.
// Returns null for events that should NOT appear as a separate log line
// (e.g. 'selected' — already reflected in the live phase indicator).
function formatLlmEvent(ev) {
  switch (ev.event) {
    case 'rate-limited':
      return `⚠ ${ev.provider}/${ev.model}${ev.keyName ? `·${ev.keyName}` : ''} rate-limited — ${(ev.error || '').slice(0, 80)}`;
    case 'key-rotated':
      return `↻ ${ev.provider} key rotated: ${ev.from} → ${ev.to}`;
    case 'provider-switched':
      return `⇄ provider switched: ${ev.from} → ${ev.to}/${ev.model}${ev.reason ? ` (${ev.reason})` : ''}`;
    case 'model-switched':
      return `↔ ${ev.provider} model switched: ${ev.from} → ${ev.to}`;
    case 'model-unavailable':
      return `✗ ${ev.provider}/${ev.model} — endpoint unavailable (404), skipping to next model`;
    case 'selected':
      return null;  // noise — phase indicator already shows this
    case 'waiting-rate-limit':
      if (ev.reason === 'reactive-all-slots') {
        return `⏱ all keys rate-limited — sleeping ${Math.ceil(ev.waitMs / 1000)}s for shortest reset window, will retry whole sweep`;
      }
      if (ev.reason === 'rpm-margin') {
        return `⏱ ${ev.provider}/${ev.model}·${ev.keyName} approaching RPM limit (${ev.usage?.rpm ?? '?'}/${ev.usage?.limits?.rpm ?? '?'}, safety margin hit); pacing — sleeping ${Math.ceil(ev.waitMs / 1000)}s`;
      }
      return `⏱ ${ev.provider}/${ev.model}·${ev.keyName} at ${ev.reason.toUpperCase()} cap (${ev.usage?.rpm ?? '?'}/${ev.usage?.limits?.rpm ?? '?'}); sleeping ${Math.ceil(ev.waitMs / 1000)}s`;
    case 'skipped-rate-limit':
      return `⊘ skipped ${ev.provider}/${ev.model}·${ev.keyName} — ${ev.reason === 'rpd' ? 'daily quota' : 'per-minute cap'} would need ${Math.ceil(ev.waitMs / 1000)}s wait`;
    default:
      return `${ev.event}: ${JSON.stringify(ev).slice(0, 120)}`;
  }
}

// Format action params into a compact readable summary for the agent log.
function formatActionParams(action, params) {
  if (!params || typeof params !== 'object') return '';
  switch (action) {
    case 'click':      return `(${params.x}, ${params.y})${params.double ? ' double' : ''}${params.button && params.button !== 'left' ? ` ${params.button}` : ''}`;
    case 'type':       return `"${(params.text || '').slice(0, 40)}${(params.text || '').length > 40 ? '…' : ''}"`;
    case 'press_keys': return `[${(params.keys || []).join('+')}]`;
    case 'scroll':     return `${params.direction || 'down'} x${params.amount || 3}`;
    case 'wait':       return `${params.ms || 1000}ms`;
    case 'pause':      return params.reason ? `(${params.reason})` : '';
    case 'done':       return params.summary ? `— ${params.summary.slice(0, 60)}` : '';
    case 'fail':       return params.reason ? `— ${params.reason.slice(0, 60)}` : '';
    default:           return '';
  }
}

export default function WorkspacePage() {
  const { contextId } = useParams();
  const navigate = useNavigate();
  const cApi = useMemo(() => ctxApi(contextId), [contextId]);

  const [state, dispatch] = useReducer(reducer, initialState);
  const [llmOpen, setLlmOpen] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);

  const refreshScreenDocs = useCallback(async () => {
    try {
      const { data } = await cApi.listScreens();
      dispatch({ type: 'REPLACE_SCREEN_DOCS', docs: data.docs });
    } catch { /* ignore */ }
  }, [cApi]);

  const refreshRagStats = useCallback(async () => {
    try {
      const [globalRag, ctxStats] = await Promise.all([
        api.get('/config/rag'),
        cApi.stats(),
      ]);
      dispatch({
        type: 'SET_RAG_INFO',
        info: {
          ...globalRag.data,
          docsOnDisk: ctxStats.data.total,
          docsIndexed: ctxStats.data.indexed,
          docsStale: ctxStats.data.stale,
          docsNotIndexed: ctxStats.data.notIndexed,
        },
      });
    } catch { /* ignore */ }
  }, [cApi]);

  const refreshAppConfig = useCallback(async () => {
    try {
      const { data } = await api.get('/config');
      dispatch({ type: 'SET_APP_CONFIG', config: data });
    } catch { /* ignore */ }
  }, []);

  const refreshKeys = useCallback(async () => {
    try {
      const { data } = await api.get('/keys');
      dispatch({ type: 'SET_API_KEYS', keys: data.keys });
    } catch { /* ignore */ }
  }, []);

  // Validate context exists, load meta
  useEffect(() => {
    setContextLoading(true);
    getContext(contextId)
      .then(({ data }) => { setContext(data); setContextLoading(false); })
      .catch(() => {
        setContextLoading(false);
        navigate('/', { replace: true });
      });
  }, [contextId, navigate]);

  // Initial load — only after we know the context is valid
  useEffect(() => {
    if (!context) return;
    refreshScreenDocs();
    refreshRagStats();
    refreshAppConfig();
    refreshKeys();
    api.get('/config/system').then(({ data }) => dispatch({ type: 'SET_SYSTEM_INFO', info: data })).catch(() => {});
    api.get('/config/chroma').then(({ data }) => dispatch({ type: 'SET_CHROMA_INFO', info: data })).catch(() => {});
  }, [context, refreshScreenDocs, refreshRagStats, refreshAppConfig, refreshKeys]);

  // Warn on unload if there are unsaved changes
  useEffect(() => {
    if (state.dirtyDocs.length === 0) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.dirtyDocs.length]);

  // --- Doc actions ---
  const handleSelectDoc = async (name) => {
    dispatch({ type: 'SELECT_DOC', name });
    if (!state.docContents[name]) {
      try {
        const { data } = await cApi.getScreen(name);
        dispatch({ type: 'SET_DOC_CONTENT', name, content: data.content });
      } catch {
        dispatch({ type: 'SET_DOC_CONTENT', name, content: `*Failed to load ${name}.screen.md*` });
      }
    }
  };

  const handleSave = async () => {
    if (!state.activeDoc) return;
    try {
      const { data } = await cApi.saveScreen(state.activeDoc, state.editDraft);
      dispatch({ type: 'SAVE_EDIT' });
      dispatch({ type: 'UPDATE_DOC_STATUS', name: state.activeDoc, status: data.status, updated_at: Date.now() });
      refreshRagStats();
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async () => {
    if (!state.activeDoc) return;
    if (!confirm(`Delete ${state.activeDoc}.screen.md?`)) return;
    try {
      await cApi.deleteScreen(state.activeDoc);
      dispatch({ type: 'REMOVE_DOC', name: state.activeDoc });
      refreshRagStats();
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCreate = async (name, content) => {
    try {
      const { data } = await cApi.createScreen(name, content);
      dispatch({ type: 'ADD_DOC', name, content, status: data.status });
      refreshRagStats();
    } catch (err) {
      alert('Create failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleIngest = async () => {
    if (isIngesting) return;
    setIsIngesting(true);
    dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: 0, message: `Re-indexing ${context?.name || 'context'} into ChromaDB...` } });
    try {
      await cApi.ingest();
      dispatch({ type: 'AGENT_LOG', entry: { type: 'done', message: 'Screen docs re-indexed successfully' } });
      refreshScreenDocs();
      refreshRagStats();
    } catch (err) {
      const details = err.response?.data?.details || err.message;
      dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: `Re-index failed: ${details}` } });
    } finally {
      setIsIngesting(false);
    }
  };

  // --- Agent run (real — calls /contexts/:id/agent/run, long-polling) ---
  const [activeRun, setActiveRun] = useState(null);  // { runId, status, pauseReason, pauseMessage }

  // Live agent status — updated from the /agent/current poll below. Drives
  // the phase indicator in PromptPanel (rag / screenshot / thinking / executing / …).
  const [agentStatus, setAgentStatus] = useState({ phase: 'idle', detail: '', since: null });

  // Poll the current-run endpoint every ~800ms while a run is in flight so the
  // user sees each step the agent takes AND the current phase (what it's
  // doing right now between step commits). Without this, the UI only surfaces
  // the final result after the long-poll returns.
  useEffect(() => {
    if (!state.agentRunning) {
      setAgentStatus({ phase: 'idle', detail: '', since: null });
      return;
    }
    let stepsSeen = 0;
    let ragSeen = false;
    let planSeen = false;
    let timer = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await cApi.agentCurrent();
        const run = data.run;
        if (run) {
          setAgentStatus({ phase: run.phase || 'idle', detail: run.phaseDetail || '', since: run.phaseSince });
        }
        // Surface RAG retrieval result exactly once per run
        if (run?.ragResult && !ragSeen) {
          ragSeen = true;
          const r = run.ragResult;
          if (r.status === 'ok') {
            const names = r.screens.map(s => s.name).join(', ') || '(none)';
            dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: '📚', message: `RAG: retrieved ${r.screens.length} screen doc(s) — ${names}` } });
          } else if (r.status === 'failed') {
            dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: `RAG query failed: ${r.error} — proceeding without screen docs` } });
          }
        }
        // Surface the planning step once available
        if (run?.plan && !planSeen) {
          planSeen = true;
          const llmLabel = run.plan.llm ? ` [${run.plan.llm.provider}/${run.plan.llm.model}]` : '';
          const stepsList = run.plan.steps.map((s, i) => `${i+1}. ${s}`).join(' | ');
          dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: '📋', message: `Plan${llmLabel}: ${stepsList}` } });
        }
        const hist = run?.history || [];
        if (hist.length > stepsSeen) {
          for (let i = stepsSeen; i < hist.length; i++) {
            const h = hist[i];
            // Emit routing events first (rate-limit, key rotation, provider
            // switch) so the user sees WHY the model for this step changed.
            // Some events (selected) are intentionally invisible — they only
            // drive the live phase indicator, not the persistent log.
            for (const ev of h.llmEvents || []) {
              const msg = formatLlmEvent(ev);
              if (msg) dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: msg } });
            }
            const paramsSummary = formatActionParams(h.action, h.params);
            const llmBadge = h.llm ? ` [${h.llm.provider}/${h.llm.model}${h.llm.keyName ? `·${h.llm.keyName}` : ''}]` : '';
            const msg = `${h.action}${paramsSummary ? ` ${paramsSummary}` : ''}${llmBadge}${h.thought ? ` — ${h.thought.slice(0, 140)}` : ''}`;
            dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: h.step, message: msg } });
          }
          stepsSeen = hist.length;
        }
      } catch { /* polling is best-effort */ }
      if (!cancelled) timer = setTimeout(tick, 800);
    };
    timer = setTimeout(tick, 300);  // first poll fast so phase shows immediately
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [state.agentRunning, cApi]);

  const handleSubmitTask = async (task) => {
    dispatch({ type: 'AGENT_LOG', entry: { type: 'user', message: task } });
    dispatch({ type: 'AGENT_RUNNING', running: true });
    try {
      const { data } = await cApi.agentRun(task);
      setActiveRun(data);
      if (data.status === 'done') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'done', message: data.result?.summary || 'Task complete' } });
      } else if (data.status === 'failed') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: data.result?.summary || 'Task failed' } });
      } else if (data.status === 'paused') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: '⏸', message: `Paused (${data.pauseReason}): ${data.pauseMessage}` } });
      }
    } catch (err) {
      dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: err.response?.data?.error || err.message } });
    } finally {
      dispatch({ type: 'AGENT_RUNNING', running: false });
    }
  };

  const handleResume = async (note) => {
    if (!activeRun) return;
    dispatch({ type: 'AGENT_LOG', entry: { type: 'user', message: `Continue${note ? `: ${note}` : ''}` } });
    dispatch({ type: 'AGENT_RUNNING', running: true });
    try {
      const { data } = await cApi.agentResume(activeRun.runId, note);
      setActiveRun(data);
      if (data.status === 'done') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'done', message: data.result?.summary || 'Task complete' } });
      } else if (data.status === 'failed') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: data.result?.summary || 'Task failed' } });
      } else if (data.status === 'paused') {
        dispatch({ type: 'AGENT_LOG', entry: { type: 'action', step: '⏸', message: `Paused (${data.pauseReason}): ${data.pauseMessage}` } });
      }
    } catch (err) {
      dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: err.response?.data?.error || err.message } });
    } finally {
      dispatch({ type: 'AGENT_RUNNING', running: false });
    }
  };

  const handleCancel = async () => {
    // While a run is in-flight the long-poll hasn't returned yet, so we don't
    // know the runId — fall back to "cancel whatever is running in this
    // context." After a pause (activeRun is set), cancel by runId directly.
    try {
      if (activeRun?.runId) {
        await cApi.agentCancel(activeRun.runId);
      } else {
        await cApi.agentCancelCurrent();
      }
      dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: 'Cancelled' } });
      setActiveRun(null);
    } catch (err) {
      dispatch({ type: 'AGENT_LOG', entry: { type: 'error', message: `Cancel failed: ${err.response?.data?.error || err.message}` } });
    }
  };

  // Show loading spinner while the context is being validated
  if (contextLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0f1117] text-slate-500 text-sm">
        Loading context...
      </div>
    );
  }
  if (!context) return null; // redirected to /

  // --- Content area ---
  let contentArea;
  if (state.mode === 'metadata' && state.activeDoc) {
    contentArea = <MetadataPanel docName={state.activeDoc} cApi={cApi} onClose={() => dispatch({ type: 'CANCEL_MODE' })} />;
  } else if (state.mode === 'create') {
    contentArea = (
      <div className="flex-1 flex flex-col p-6 gap-3">
        <div className="text-sm font-medium text-slate-300">Create New Screen Doc</div>
        <input
          type="text"
          placeholder="Screen name (e.g. notification-settings)"
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-500/50"
          value={state.createDraft.name}
          onChange={(e) => dispatch({ type: 'UPDATE_CREATE_DRAFT', fields: { name: e.target.value } })}
        />
        <textarea
          placeholder="Describe the screen layout..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-slate-200 font-mono resize-none outline-none focus:border-violet-500/50"
          value={state.createDraft.content}
          onChange={(e) => dispatch({ type: 'UPDATE_CREATE_DRAFT', fields: { content: e.target.value } })}
        />
        <div className="flex gap-2">
          <button
            className="px-4 py-1.5 rounded text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-40"
            disabled={!state.createDraft.name.trim()}
            onClick={() => handleCreate(state.createDraft.name.trim(), state.createDraft.content || `# ${state.createDraft.name.trim()}\n\n`)}
          >
            Create
          </button>
          <button
            className="px-4 py-1.5 rounded text-sm text-slate-400 hover:bg-zinc-800 transition-colors"
            onClick={() => dispatch({ type: 'CANCEL_MODE' })}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (state.mode === 'edit' && state.activeDoc) {
    contentArea = (
      <DocEditor content={state.editDraft} onChange={(c) => dispatch({ type: 'UPDATE_DRAFT', content: c })} />
    );
  } else if (state.activeDoc) {
    contentArea = <DocViewer name={state.activeDoc} content={state.docContents[state.activeDoc]} />;
  } else {
    contentArea = (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
        Select a screen doc from the sidebar
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0f1117]">
      <Toolbar
        activeDoc={state.activeDoc}
        mode={state.mode}
        contextName={context?.name}
        contextSlug={context?.slug}
        pendingCount={(state.ragInfo.docsStale ?? 0) + (state.ragInfo.docsNotIndexed ?? 0)}
        isIngesting={isIngesting}
        onNew={() => dispatch({ type: 'START_CREATE' })}
        onEdit={() => dispatch({ type: 'START_EDIT' })}
        onSave={handleSave}
        onCancel={() => dispatch({ type: 'CANCEL_MODE' })}
        onDelete={handleDelete}
        onInfo={() => dispatch({ type: 'OPEN_METADATA' })}
        onIngest={handleIngest}
        onOpenLlm={() => setLlmOpen(true)}
      />

      <Group orientation="horizontal" className="flex-1 min-h-0">
        <Panel id="sidebar" defaultSize="18" minSize="14" maxSize="30">
          <Sidebar
            screenDocs={state.screenDocs}
            openTabs={state.openTabs}
            activeDoc={state.activeDoc}
            dirtyDocs={state.dirtyDocs}
            onSelectDoc={handleSelectDoc}
            onCloseTab={(name) => dispatch({ type: 'CLOSE_TAB', name })}
            onCreateDoc={() => dispatch({ type: 'START_CREATE' })}
          />
        </Panel>

        <Separator className="w-px bg-zinc-800 hover:bg-violet-600 transition-colors data-[resize-handle-active]:bg-violet-600" />

        <Panel id="main" defaultSize="82">
          <Group orientation="vertical" className="h-full">
            <Panel id="content" defaultSize="70" minSize="30">
              <div className="h-full flex flex-col">
                <TabBar
                  tabs={state.openTabs}
                  activeDoc={state.activeDoc}
                  dirtyDocs={state.dirtyDocs}
                  onSelect={handleSelectDoc}
                  onClose={(name) => dispatch({ type: 'CLOSE_TAB', name })}
                />
                {contentArea}
              </div>
            </Panel>

            <Separator className="h-px bg-zinc-800 hover:bg-violet-600 transition-colors data-[resize-handle-active]:bg-violet-600" />

            <Panel id="prompt" defaultSize="30" minSize="140px" maxSize="50">
              <PromptPanel
                onSubmit={handleSubmitTask}
                isRunning={state.agentRunning}
                agentLog={state.agentLog}
                agentStatus={agentStatus}
                screenDocs={state.screenDocs.map(d => d.name)}
                pausedRun={activeRun?.status === 'paused' ? activeRun : null}
                onResume={handleResume}
                onCancel={handleCancel}
              />
            </Panel>
          </Group>
        </Panel>
      </Group>

      <LlmDrawer
        open={llmOpen}
        onClose={() => setLlmOpen(false)}
        appConfig={state.appConfig}
        systemInfo={state.systemInfo}
        chromaStatus={state.chromaInfo.status}
        ragInfo={state.ragInfo}
        keys={state.apiKeys}
        onReloadConfig={refreshAppConfig}
        onReloadKeys={refreshKeys}
        onIngest={handleIngest}
      />
    </div>
  );
}
