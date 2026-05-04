import { useEffect, useMemo, useRef, useState } from 'react';

// Large ASCII art title. On hover a scramble effect runs over each cell of
// the printed grid — characters flip to random glyphs then settle back to the
// original. The animation is bounded (ticks count up to STEPS) so it never
// loops forever; re-entering restarts it.

const TITLE = String.raw`
 ██╗  ██╗██████╗  █████╗ ██╗  ██╗███████╗███╗   ██╗
 ██║ ██╔╝██╔══██╗██╔══██╗██║ ██╔╝██╔════╝████╗  ██║
 █████╔╝ ██████╔╝███████║█████╔╝ █████╗  ██╔██╗ ██║
 ██╔═██╗ ██╔══██╗██╔══██║██╔═██╗ ██╔══╝  ██║╚██╗██║
 ██║  ██╗██║  ██║██║  ██║██║  ██╗███████╗██║ ╚████║
 ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
`;

const SUBTITLE = String.raw`
 █████╗ ███████╗███████╗██╗███████╗████████╗
██╔══██╗██╔════╝██╔════╝██║██╔════╝╚══██╔══╝
███████║███████╗███████╗██║███████╗   ██║
██╔══██║╚════██║╚════██║██║╚════██║   ██║
██║  ██║███████║███████║██║███████║   ██║
╚═╝  ╚═╝╚══════╝╚══════╝╚═╝╚══════╝   ╚═╝
`;

const SCRAMBLE_POOL = '!@#$%^&*()_+-=[]{}|;:<>?/\\~`01';
const STEPS = 18;

function scrambleLine(target, progress) {
  // progress 0 → fully scrambled, 1 → fully revealed
  let out = '';
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    if (ch === ' ' || ch === '\n') { out += ch; continue; }
    // reveal character once its per-char threshold is passed
    const threshold = (i % 12) / 12;
    if (progress > threshold) out += ch;
    else out += SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
  }
  return out;
}

export default function AsciiHero() {
  const [tick, setTick] = useState(STEPS); // start settled
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  const titleLines = useMemo(() => TITLE.split('\n'), []);
  const subtitleLines = useMemo(() => SUBTITLE.split('\n'), []);

  useEffect(() => {
    if (tick >= STEPS) return;
    const step = (ts) => {
      if (ts - lastTsRef.current > 40) {
        lastTsRef.current = ts;
        setTick(t => Math.min(STEPS, t + 1));
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const triggerScramble = () => {
    lastTsRef.current = 0;
    setTick(0);
  };

  const progress = tick / STEPS;
  const renderedTitle = progress >= 1
    ? titleLines
    : titleLines.map(line => scrambleLine(line, progress));
  const renderedSubtitle = progress >= 1
    ? subtitleLines
    : subtitleLines.map(line => scrambleLine(line, progress));

  return (
    <div
      className="relative select-none cursor-default"
      onMouseEnter={triggerScramble}
    >
      <pre className="font-mono text-emerald-400 leading-[1.05] text-[9px] sm:text-[12px] md:text-[14px] lg:text-[15px] whitespace-pre m-0 [text-shadow:0_0_18px_rgba(52,211,153,0.22)]">
{renderedTitle.join('\n')}
      </pre>
      <pre className="font-mono text-slate-300/80 leading-[1.05] text-[7px] sm:text-[10px] md:text-[11px] lg:text-[12px] whitespace-pre m-0 mt-1 ml-[2ch]">
{renderedSubtitle.join('\n')}
      </pre>
    </div>
  );
}
