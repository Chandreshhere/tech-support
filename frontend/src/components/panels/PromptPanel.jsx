import { useState, useRef, useEffect } from 'react';
import {
  RiSendPlaneLine, RiLoader4Line, RiStopCircleLine,
  RiMarkdownLine, RiTimeLine, RiPauseCircleLine, RiCheckLine,
  RiInformationLine,
} from 'react-icons/ri';

// Labels for pause reasons — shown in the pause card header.
const PAUSE_REASON_LABELS = {
  password:          'Password required',
  otp:               'Verification code required',
  captcha:           'CAPTCHA to solve',
  'email-verify':    'Email verification needed',
  '2fa':             '2FA code required',
  payment:           'Payment details needed',
  'ambiguous-choice': 'Clarification needed',
  other:             'Your input needed',
};

function PauseCard({ run, onResume, onCancel }) {
  const [note, setNote] = useState('');
  const label = PAUSE_REASON_LABELS[run.pauseReason] || PAUSE_REASON_LABELS.other;

  return (
    <div className="mx-3 mt-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
      <div className="flex items-start gap-2">
        <RiPauseCircleLine size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">{label}</div>
          <div className="text-[13px] text-slate-200 mt-1">{run.pauseMessage}</div>

          {run.pauseReason === 'ambiguous-choice' || run.pauseReason === 'otp' || run.pauseReason === '2fa' ? (
            <div className="mt-2">
              <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-0.5">
                Optional: tell the agent the answer (otherwise just do it yourself and click Continue)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  run.pauseReason === 'otp' ? 'e.g. 482931' :
                  run.pauseReason === '2fa' ? 'e.g. 123456' :
                  'e.g. use the work account'
                }
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[12px] text-slate-200 outline-none focus:border-amber-500/50"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onResume(note || null); setNote(''); } }}
              />
            </div>
          ) : null}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { onResume(note || null); setNote(''); }}
              className="flex items-center gap-1 px-3 py-1 rounded text-[12px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <RiCheckLine size={13} /> Continue
            </button>
            <button
              onClick={onCancel}
              className="flex items-center gap-1 px-3 py-1 rounded text-[12px] text-slate-400 hover:bg-zinc-800"
            >
              Cancel task
            </button>
          </div>
          <div className="mt-2 flex items-start gap-1 text-[10px] text-amber-300/70">
            <RiInformationLine size={11} className="shrink-0 mt-0.5" />
            <span>After Continue, the agent takes a fresh screenshot — it'll adapt to whichever screen you're on now, even if you switched windows.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Maps agent.phase → short label + accent color for the status pill.
const PHASE_LABELS = {
  idle:          { label: 'Idle',              color: 'text-slate-500' },
  rag:           { label: 'Searching docs',    color: 'text-sky-400' },
  screenshot:    { label: 'Capturing screen',  color: 'text-sky-400' },
  thinking:      { label: 'Calling LLM',       color: 'text-violet-400' },
  'waiting-rpm': { label: 'Waiting on quota',  color: 'text-amber-400' },
  executing:     { label: 'Executing action',  color: 'text-emerald-400' },
  settling:      { label: 'Waiting for UI',    color: 'text-amber-400' },
  paused:        { label: 'Paused',            color: 'text-amber-400' },
};

function PhaseBadge({ agentStatus }) {
  const info = PHASE_LABELS[agentStatus?.phase] || { label: agentStatus?.phase || 'Running', color: 'text-violet-400' };
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!agentStatus?.since) { setElapsed(0); return; }
    const update = () => setElapsed(Math.floor((Date.now() - agentStatus.since) / 1000));
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [agentStatus?.since]);

  return (
    <span className={`flex items-center gap-1 text-[10px] ${info.color}`} title={agentStatus?.detail || ''}>
      <RiLoader4Line size={10} className="animate-spin" />
      <span className="font-medium">{info.label}</span>
      {agentStatus?.detail && (
        <span className="text-slate-500 truncate max-w-[180px]">— {agentStatus.detail}</span>
      )}
      {elapsed > 1 && <span className="text-slate-600">({elapsed}s)</span>}
    </span>
  );
}

export default function PromptPanel({
  onSubmit, isRunning, agentLog = [], agentStatus, screenDocs = [],
  pausedRun, onResume, onCancel,
}) {
  const [prompt, setPrompt] = useState('');
  const [mention, setMention] = useState(null);
  const textareaRef = useRef(null);
  const listRef = useRef(null);

  // Filter screen docs matching the @ query
  const filtered = mention
    ? screenDocs.filter((name) => name.toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  // Scroll active mention into view
  useEffect(() => {
    if (!mention || !listRef.current) return;
    const active = listRef.current.children[mention.index];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [mention?.index]);

  // Close mention dropdown on outside click
  useEffect(() => {
    if (!mention) return;
    function handleClick(e) {
      if (!e.target.closest('[data-mention-list]')) setMention(null);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mention]);

  function handleChange(e) {
    const value = e.target.value;
    setPrompt(value);
    // Detect @ trigger for mention autocomplete
    const cursor = e.target.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/@([^\s]*)$/);
    if (match) {
      setMention({ query: match[1], start: cursor - match[0].length, index: 0 });
    } else {
      setMention(null);
    }
  }

  function insertMention(docName) {
    if (!mention) return;
    const before = prompt.slice(0, mention.start);
    const after = prompt.slice(mention.start + mention.query.length + 1);
    const newPrompt = before + '@' + docName + ' ' + after;
    setPrompt(newPrompt);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = before.length + docName.length + 2;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e) {
    // Mention navigation
    if (mention && filtered.length > 0) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + filtered.length) % filtered.length })); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % filtered.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[mention.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
    // Submit on Enter (Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  }

  function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || isRunning) return;
    onSubmit(trimmed);
    setPrompt('');
    setMention(null);
  }

  return (
    <div className="h-full flex bg-[#0f1117]" data-mention-list>
      {/* Left: agent log */}
      <div className="w-2/5 border-r border-zinc-800 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-slate-600 uppercase tracking-wider shrink-0">Agent Log</span>
          {isRunning && <PhaseBadge agentStatus={agentStatus} />}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {agentLog.length === 0 ? (
            <p className="text-xs text-slate-600 italic px-3 py-4 text-center">No activity yet</p>
          ) : (
            [...agentLog].reverse().map((entry, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 px-3 py-1.5 text-xs border-b border-zinc-800/50 ${
                  entry.type === 'user' ? 'text-violet-300' :
                  entry.type === 'error' ? 'text-red-400' :
                  entry.type === 'done' ? 'text-emerald-400' :
                  'text-slate-400'
                }`}
              >
                {entry.type === 'user' && <RiTimeLine size={11} className="shrink-0 mt-0.5 text-violet-500" />}
                <span className="flex-1">
                  {entry.type === 'user' && <span className="font-medium">Task: </span>}
                  {entry.type === 'action' && <span className="text-slate-600">Step {entry.step}: </span>}
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: pause card (if any) + textarea + mention picker */}
      <div className="flex-1 flex flex-col min-h-0">
        {pausedRun && (
          <PauseCard run={pausedRun} onResume={onResume} onCancel={onCancel} />
        )}
        <div className="flex-1 flex flex-col p-3 min-h-0">
        {/* Mention autocomplete dropdown */}
        {mention && filtered.length > 0 && (
          <div ref={listRef} className="max-h-32 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded-lg mb-1.5 shrink-0">
            {filtered.map((name, i) => (
              <button
                key={name}
                onClick={() => insertMention(name)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  i === mention.index ? 'bg-violet-600/20 text-slate-100' : 'text-slate-400 hover:bg-zinc-700 hover:text-slate-200'
                }`}
              >
                <RiMarkdownLine size={13} className="shrink-0 text-slate-500" />
                <span className="truncate">{name}.screen.md</span>
              </button>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="flex-1 relative min-h-0">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder="Write your task... (@ to mention screen docs, Shift+Enter for new line)"
            className="w-full h-full bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-slate-200
              resize-none p-3 pb-10 outline-none focus:border-violet-600/50 transition-colors
              placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            onClick={isRunning ? onCancel : handleSubmit}
            disabled={!isRunning && !prompt.trim()}
            className={`absolute bottom-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
              ${isRunning
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-violet-600'
              }`}
          >
            {isRunning ? (
              <><RiStopCircleLine size={12} /> Stop</>
            ) : (
              <><RiSendPlaneLine size={12} /> Submit</>
            )}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
