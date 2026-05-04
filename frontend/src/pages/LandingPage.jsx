import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RiLoader4Line } from 'react-icons/ri';
import AsciiRain from '../components/landing/AsciiRain.jsx';
import AsciiHero from '../components/landing/AsciiHero.jsx';
import GlitchText from '../components/landing/GlitchText.jsx';
import { resolveNextRoute } from '../utils/status.js';

const NAV = [
  { label: 'CAPABILITIES', href: '#caps' },
  { label: 'LOOP',   href: '#about'   },
  { label: 'DOCS',   href: '#about'   },
];

function NavItem({ label, href, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={href}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-[10px] tracking-[0.28em] text-slate-400 hover:text-emerald-400 transition-colors"
    >
      <GlitchText text={label} active={hover} />
    </a>
  );
}

function CTAButton({ onClick, loading }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative inline-block group select-none">
      {/* targeting reticle — corner glyphs sit outside the button and
          pull in on hover, telegraphing "focus here". */}
      <span className="absolute -top-3 -left-3 text-emerald-400 font-mono text-[14px] leading-none transition-transform group-hover:translate-x-1 group-hover:translate-y-1">┌</span>
      <span className="absolute -top-3 -right-3 text-emerald-400 font-mono text-[14px] leading-none transition-transform group-hover:-translate-x-1 group-hover:translate-y-1">┐</span>
      <span className="absolute -bottom-3 -left-3 text-emerald-400 font-mono text-[14px] leading-none transition-transform group-hover:translate-x-1 group-hover:-translate-y-1">└</span>
      <span className="absolute -bottom-3 -right-3 text-emerald-400 font-mono text-[14px] leading-none transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1">┘</span>

      {/* ambient halo — solid-color shadow, not a gradient. */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none blur-2xl bg-emerald-500/25 group-hover:bg-emerald-400/40 transition-colors"
      />

      <button
        onClick={onClick}
        disabled={loading}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="relative inline-flex items-center gap-3 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-500 text-black font-mono text-[13px] tracking-[0.32em] font-bold disabled:opacity-60 disabled:cursor-wait transition-colors shadow-[0_0_0_1px_rgba(16,185,129,1),0_0_30px_rgba(16,185,129,0.45)]"
      >
        {loading
          ? <RiLoader4Line size={14} className="animate-spin" />
          : <span className="text-black">▸</span>}
        <GlitchText text={loading ? 'PROBING_STATE' : 'INITIATE_SESSION'} active={hover} />
        <span className="inline-block w-[8px] h-[14px] bg-black animate-cta-blink" />
      </button>

      {/* caption below — reads as an instruction, not decoration. */}
      <div className="mt-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.35em] text-emerald-400/70 group-hover:text-emerald-300 transition-colors">
        <span>└─</span>
        <span>PRESS TO DEPLOY</span>
        <span className="flex-1 h-px bg-emerald-500/30" />
        <span className="text-emerald-400">↵</span>
      </div>
    </div>
  );
}

function StatusLine({ label, value, tone = 'default' }) {
  const colour = tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-slate-400';
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-700">::</span>
      <span className={colour}>{value}</span>
    </div>
  );
}

// Three feature cards, each a boxed ASCII-bordered panel.
function FeatureCard({ glyph, title, body }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative border border-zinc-800 hover:border-emerald-500/50 transition-colors bg-black/40 p-5 group"
    >
      <div className="absolute top-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┌</div>
      <div className="absolute top-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┐</div>
      <div className="absolute bottom-0 left-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">└</div>
      <div className="absolute bottom-0 right-0 text-emerald-500/40 font-mono text-[10px] leading-none select-none">┘</div>

      <pre className="font-mono text-emerald-400 text-[10px] leading-tight whitespace-pre mb-3 opacity-80 group-hover:opacity-100">
{glyph}
      </pre>
      <div className="font-mono text-[11px] tracking-[0.2em] text-slate-200 mb-2">
        <GlitchText text={title} active={hover} />
      </div>
      <p className="text-[12px] text-slate-500 leading-relaxed font-mono">{body}</p>
    </div>
  );
}

const CARDS = [
  {
    glyph:
`┌─[ mouse ]─┐
│  ● ● ●    │
│  ↘ CLICK  │
└───────────┘`,
    title: 'CURSOR_CONTROL',
    body:
`Operates your pointer with sub-pixel precision.
Drag, double-click, hover — indistinguishable
from a human driving the machine.`,
  },
  {
    glyph:
`┌─[ keys ]──┐
│ [Q][W][E]│
│ [A][S][D]│
└───────────┘`,
    title: 'KEYSTROKE_INJECTION',
    body:
`Types into any focused field, triggers
shortcuts, sends modifier combos. Works
across every app without integration.`,
  },
  {
    glyph:
`┌─[ term ]──┐
│ $ _       │
│ > exec    │
└───────────┘`,
    title: 'SHELL_PROTOCOL',
    body:
`Spawns terminals and runs commands
on your behalf — with full screen vision
to verify each result before continuing.`,
  },
  {
    glyph:
`┌─[ vision ]┐
│ ◉ scan    │
│ ▒▒▒▒▒▒▒▒ │
└───────────┘`,
    title: 'SCREEN_CAPTURE',
    body:
`Every step begins with a fresh screenshot.
The agent reads what is on screen the same
way you would — by looking.`,
  },
];

const PROOF_LINES = [
  'PROOF OF AUTONOMY.',
  'REIMAGINED.',
];

export default function LandingPage() {
  const navigate = useNavigate();

  // Idle uptime counter — purely cosmetic, reinforces the "live system" feel.
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setUptime(u => u + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // CTA asks the backend what's missing (keys / model / project) and routes
  // to the exact step needed. If everything is in place we open the project
  // directly; dashboard only when the user has several to choose between.
  const [routing, setRouting] = useState(false);
  const handleCTA = async () => {
    if (routing) return;
    setRouting(true);
    try {
      const { route } = await resolveNextRoute();
      navigate(route);
    } catch {
      navigate('/onboarding');
    } finally {
      setRouting(false);
    }
  };

  const fmt = (n) => String(n).padStart(2, '0');
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = uptime % 60;

  return (
    <div className="relative min-h-screen bg-black text-slate-200 overflow-hidden">
      <AsciiRain />

      {/* soft vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_40%,rgba(0,0,0,0.85)_100%)]" />

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* ============ HEADER ============ */}
        <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-zinc-900/80">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[15px] tracking-[0.1em] text-slate-200">
              kraken<span className="text-emerald-400">.assist</span>
            </span>
            <span className="hidden sm:inline-block px-1.5 py-[2px] border border-emerald-500/30 text-emerald-400 text-[9px] font-mono tracking-[0.25em]">
              v0.1 · ALPHA
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            {NAV.map(n => <NavItem key={n.label} {...n} />)}
          </nav>

          <div className="flex items-center gap-4 text-right">
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <span className="text-[9px] text-slate-600 tracking-[0.28em]">UPTIME</span>
              <span className="text-[10px] text-emerald-400 font-mono tracking-wider">
                {fmt(h)}:{fmt(m)}:{fmt(s)}
              </span>
            </div>
            <button
              onClick={handleCTA}
              className="hidden sm:inline-block text-[10px] tracking-[0.28em] text-slate-400 hover:text-emerald-400 transition-colors font-mono border-l border-zinc-800 pl-4"
            >
              [ START ]
            </button>
          </div>
        </header>

        {/* ============ HERO ============ */}
        <main className="flex-1 flex flex-col">
          <section className="flex-1 flex items-center justify-center px-6 md:px-10 py-16 md:py-20">
            <div className="w-full max-w-6xl">

              {/* status bar above title */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-8 pb-4 border-b border-zinc-900">
                <StatusLine label="NODE" value="LOCAL/127.0.0.1" tone="ok" />
                <StatusLine label="AGENT" value="STANDBY" tone="ok" />
                <StatusLine label="VISION" value="ENABLED" tone="ok" />
                <StatusLine label="MODELS" value="GEMINI · GROQ · OPENROUTER" />
              </div>

              {/* ASCII hero title */}
              <div className="overflow-x-auto scrollbar-none">
                <AsciiHero />
              </div>

              {/* tagline + CTA */}
              <div className="mt-10 md:mt-14 grid md:grid-cols-[1fr_auto] gap-8 items-end">
                <div className="max-w-xl">
                  <p className="font-mono text-[11px] tracking-[0.24em] text-emerald-400/90 mb-3">
                    // AI_OPERATOR · TECH_SUPPORT · v0.1
                  </p>
                  <p className="text-slate-300 text-[14px] md:text-[15px] leading-relaxed font-mono">
                    An autonomous tech-support agent that <span className="text-emerald-400">sees your screen</span>,
                    drives your <span className="text-emerald-400">mouse, keyboard and terminal</span>,
                    and resolves tasks from a plain-language prompt.
                  </p>
                  <p className="text-slate-500 text-[12px] leading-relaxed mt-3 font-mono">
                    Think of it as remote assistance — without the remote operator.
                  </p>
                </div>

                <div className="flex flex-col items-start md:items-end">
                  <CTAButton onClick={handleCTA} loading={routing} />
                </div>
              </div>
            </div>
          </section>

          {/* ============ FEATURE GRID ============ */}
          <section id="caps" className="px-6 md:px-10 py-12 border-t border-zinc-900">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center gap-4 mb-8">
                <span className="font-mono text-[10px] tracking-[0.3em] text-emerald-400">[ 0x01 ]</span>
                <span className="font-mono text-[12px] tracking-[0.28em] text-slate-300">CAPABILITIES</span>
                <span className="flex-1 h-px bg-zinc-900" />
                <span className="font-mono text-[9px] tracking-[0.3em] text-slate-600">04 MODULES</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {CARDS.map(c => <FeatureCard key={c.title} {...c} />)}
              </div>
            </div>
          </section>

          {/* ============ HOW / ABOUT ============ */}
          <section id="about" className="px-6 md:px-10 py-12 border-t border-zinc-900">
            <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10">
              <div>
                <div className="flex items-center gap-4 mb-6">
                  <span className="font-mono text-[10px] tracking-[0.3em] text-emerald-400">[ 0x02 ]</span>
                  <span className="font-mono text-[12px] tracking-[0.28em] text-slate-300">LOOP</span>
                </div>
                <pre className="font-mono text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap">
{`while (task.pending) {
  frame   = capture_screen();
  context = retrieve_rag(task);
  plan    = llm.decide(frame, context);
  execute(plan.action);   // click | type | scroll | shell
}
return summary;`}
                </pre>
              </div>
              <div>
                <div className="flex items-center gap-4 mb-6">
                  <span className="font-mono text-[10px] tracking-[0.3em] text-emerald-400">[ 0x03 ]</span>
                  <span className="font-mono text-[12px] tracking-[0.28em] text-slate-300">MANIFEST</span>
                </div>
                <p className="font-mono text-[12px] leading-relaxed text-slate-400">
                  Support desks scale by hiring. Kraken scales by <span className="text-emerald-400">looking at the same screen</span> as your user and finishing the task for them. No screen-share sessions. No callbacks.
                </p>
                <p className="font-mono text-[12px] leading-relaxed text-slate-500 mt-3">
                  Bring your own keys. Your data never leaves the machine.
                </p>
              </div>
            </div>
          </section>
        </main>

        {/* ============ FOOTER ============ */}
        <footer className="border-t border-zinc-900 px-6 md:px-10 py-6">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              {PROOF_LINES.map((l, i) => (
                <div key={i} className="font-mono text-[13px] tracking-[0.18em] text-slate-200">
                  {l}
                </div>
              ))}
            </div>
            <div className="font-mono text-[10px] text-slate-500 leading-relaxed max-w-md text-right">
              KRAKEN IS A LOCAL AI OPERATOR THAT RESOLVES TECH-SUPPORT TASKS BY DRIVING THE USER&apos;S MACHINE DIRECTLY — MOUSE, KEYBOARD, AND TERMINAL — FROM A NATURAL-LANGUAGE PROMPT.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
