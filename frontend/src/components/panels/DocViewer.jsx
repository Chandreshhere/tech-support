import ReactMarkdown from 'react-markdown';

export default function DocViewer({ content }) {
  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center font-mono text-[10px] tracking-[0.28em] text-slate-600">
        SELECT A SCREEN DOC FROM THE SIDEBAR
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-black">
      <article className="prose prose-invert prose-sm max-w-none
        prose-headings:text-slate-100 prose-headings:font-mono prose-headings:tracking-[0.04em]
        prose-p:text-slate-400
        prose-strong:text-emerald-300
        prose-li:text-slate-400
        prose-code:text-emerald-300 prose-code:bg-emerald-500/5 prose-code:border prose-code:border-emerald-500/20 prose-code:px-1 prose-code:rounded-none prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-black prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-none
        prose-a:text-emerald-400 hover:prose-a:text-emerald-300
        prose-hr:border-zinc-800
        prose-blockquote:border-emerald-500/40 prose-blockquote:text-slate-300">
        <ReactMarkdown>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
