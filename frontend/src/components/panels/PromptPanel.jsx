import { useState, useRef, useEffect } from 'react';
import {
  RiSendPlaneLine, RiLoader4Line, RiStopCircleLine,
  RiMarkdownLine, RiTimeLine, RiPauseCircleLine, RiCheckLine,
  RiInformationLine,
} from 'react-icons/ri';

// Labels for pause reasons — shown in the pause card header.
const PAUSE_REASON_LABELS = {
  password:          'PASSWORD REQUIRED',
  otp:               'VERIFICATION CODE REQUIRED',
  captcha:           'CAPTCHA TO SOLVE',
  'email-verify':    'EMAIL VERIFICATION NEEDED',
  '2fa':             '2FA CODE REQUIRED',
  payment:           'PAYMENT DETAILS NEEDED',
  'ambiguous-choice': 'CLARIFICATION NEEDED',
  other:             'YOUR INPUT NEEDED',
};

function PauseCard({ run, onResume, onCancel }) {
  const [note, setNote] = useState('');
  const label = PAUSE_REASON_LABELS[run.pauseReason] || PAUSE_REASON_LABELS.other;

  return (
    <div className="mx-3 mt-2 p-3 border border-amber-500/40 bg-amber-500/5">
      <div className="flex items-start gap-2">
        <RiPauseCircleLine size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] tracking-[0.28em] text-amber-300">{label}</div>
          <div className="font-mono text-[12px] text-slate-200 mt-1 leading-relaxed">{run.pauseMessage}</div>

          {run.pauseReason === 'ambiguous-choice' || run.pauseReason === 'otp' || run.pauseReason === '2fa' ? (
            <div className="mt-2">
              <label className="block font-mono text-[9px] text-slate-500 tracking-[0.25em] mb-0.5">
                OPTIONAL: TELL THE AGENT, OR DO IT YOURSELF AND CONTINUE
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
                className="w-full bg-black border border-amber-500/40 hover:border-amber-400 focus:border-amber-300 outline-none font-mono text-[12px] text-slate-200 placeholder:text-slate-700 px-2 py-1"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onResume(note || null); setNote(''); } }}
              />
            </div>
          ) : null}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { onResume(note || null); setNote(''); }}
              className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] tracking-[0.28em] border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 transition-colors"
            >
              <RiCheckLine size={12} /> CONTINUE
            </button>
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] tracking-[0.28em] text-slate-500 hover:text-red-400 transition-colors"
            >
              CANCEL_TASK
            </button>
          </div>
          <div className="mt-2 flex items-start gap-1 font-mono text-[9px] text-amber-300/70 leading-relaxed tracking-wider">
            <RiInformationLine size={11} className="shrink-0 mt-0.5" />
            <span>ON CONTINUE, AGENT TAKES A FRESH SCREENSHOT — ADAPTS TO WHICHEVER SCREEN YOU&apos;RE ON NOW.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// agent.phase → short label + accent colour for the status pill.
const PHASE_LABELS = {
  idle:          { label: 'IDLE',         color: 'text-slate-500' },
  rag:           { label: 'SEARCHING',    color: 'text-sky-400' },
  screenshot:    { label: 'CAPTURING',    color: 'text-sky-400' },
  thinking:      { label: 'LLM_CALL',     color: 'text-emerald-400' },
  'waiting-rpm': { label: 'QUOTA_WAIT',   color: 'text-amber-400' },
  executing:     { label: 'EXECUTING',    color: 'text-emerald-400' },
  settling:      { label: 'UI_SETTLE',    color: 'text-amber-400' },
  paused:        { label: 'PAUSED',       color: 'text-amber-400' },
};

function PhaseBadge({ agentStatus }) {
  const info = PHASE_LABELS[agentStatus?.phase] || { label: (agentStatus?.phase || 'RUNNING').toUpperCase(), color: 'text-emerald-400' };
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!agentStatus?.since) return;
    const update = () => setElapsed(Math.floor((Date.now() - agentStatus.since) / 1000));
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [agentStatus?.since]);

  // reset elapsed when phase loses its start marker — done via render-derivation
  const displayElapsed = agentStatus?.since ? elapsed : 0;

  return (
    <span className={`flex items-center gap-1 font-mono text-[9px] tracking-[0.25em] ${info.color}`} title={agentStatus?.detail || ''}>
      <RiLoader4Line size={10} className="animate-spin" />
      <span>{info.label}</span>
      {agentStatus?.detail && (
        <span className="text-slate-500 truncate max-w-[180px] normal-case tracking-normal">— {agentStatus.detail}</span>
      )}
      {displayElapsed > 1 && <span className="text-slate-600">({displayElapsed}s)</span>}
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

  const filtered = mention
    ? screenDocs.filter((name) => name.toLowerCase().includes(mention.query.toLowerCase()))
    : [];

  useEffect(() => {
    if (!mention || !listRef.current) return;
    const active = listRef.current.children[mention.index];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [mention?.index]);

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
    if (mention && filtered.length > 0) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + filtered.length) % filtered.length })); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % filtered.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[mention.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
    }
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
    <div className="h-full flex bg-black" data-mention-list>
      {/* Left: agent log */}
      <div className="w-2/5 border-r border-zinc-900 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-zinc-900 shrink-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-mono text-[9px]">▸</span>
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">AGENT_LOG</span>
          </div>
          {isRunning && <PhaseBadge agentStatus={agentStatus} />}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {agentLog.length === 0 ? (
            <p className="font-mono text-[10px] tracking-wider text-slate-700 px-3 py-4 text-center">
              // NO ACTIVITY YET
            </p>
          ) : (
            [...agentLog].reverse().map((entry, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 px-3 py-1.5 font-mono text-[11px] border-b border-zinc-900/80 ${
                  entry.type === 'user'  ? 'text-emerald-300' :
                  entry.type === 'error' ? 'text-red-400'    :
                  entry.type === 'done'  ? 'text-emerald-400' :
                                           'text-slate-400'
                }`}
              >
                {entry.type === 'user' && <RiTimeLine size={11} className="shrink-0 mt-0.5 text-emerald-500" />}
                <span className="flex-1 leading-relaxed">
                  {entry.type === 'user' && <span className="font-bold">TASK: </span>}
                  {entry.type === 'action' && <span className="text-slate-600">step {entry.step}: </span>}
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
            <div ref={listRef} className="max-h-32 overflow-y-auto bg-black border border-emerald-500/40 mb-1.5 shrink-0 shadow-[0_0_20px_rgba(16,185,129,0.15)]">
              {filtered.map((name, i) => (
                <button
                  key={name}
                  onClick={() => insertMention(name)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors ${
                    i === mention.index ? 'bg-emerald-500/10 text-emerald-200' : 'text-slate-400 hover:bg-emerald-500/[0.04] hover:text-slate-200'
                  }`}
                >
                  <RiMarkdownLine size={12} className="shrink-0 text-emerald-500/70" />
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
              placeholder="> write your task... (@ to mention screen docs · shift+enter for newline)"
              className="w-full h-full bg-black border border-emerald-500/30 hover:border-emerald-500/60 focus:border-emerald-400 font-mono text-[12px] text-slate-200
                resize-none p-3 pb-11 outline-none transition-colors
                placeholder:text-slate-700 caret-emerald-400 disabled:opacity-50"
            />
            <button
              onClick={isRunning ? onCancel : handleSubmit}
              disabled={!isRunning && !prompt.trim()}
              className={`absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] tracking-[0.28em] border transition-colors
                ${isRunning
                  ? 'border-red-500/50 text-red-300 hover:bg-red-500/10 hover:border-red-400'
                  : 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-200 disabled:opacity-30 disabled:cursor-not-allowed'
                }`}
            >
              {isRunning ? (
                <><RiStopCircleLine size={12} /> STOP</>
              ) : (
                <><RiSendPlaneLine size={12} /> DEPLOY</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
