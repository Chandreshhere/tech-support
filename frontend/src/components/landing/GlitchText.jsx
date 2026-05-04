import { useEffect, useRef, useState } from 'react';

const POOL = '!<>-_\\/[]{}—=+*^?#________';

// Short "cipher reveal" animation — used for hover-responsive labels.
// While `active` is true an rAF loop writes each frame into state. While
// it's false we render `text` directly and skip the effect body entirely,
// so we never setState synchronously in the effect.
export default function GlitchText({ text, active = false, duration = 380, className = '' }) {
  const [frame, setFrame] = useState(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let start = 0;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      let s = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === ' ') { s += ' '; continue; }
        const thresh = (i / Math.max(1, text.length - 1)) * 0.7 + 0.15;
        s += p > thresh ? ch : POOL[Math.floor(Math.random() * POOL.length)];
      }
      setFrame(s);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, text, duration]);

  return <span className={`font-mono ${className}`}>{active && frame != null ? frame : text}</span>;
}
