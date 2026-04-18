import ReactMarkdown from 'react-markdown';

export default function DocViewer({ content, name }) {
  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
        Select a screen doc from the sidebar to view it
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <article className="prose prose-invert prose-sm max-w-none
        prose-headings:text-slate-200 prose-p:text-slate-400
        prose-strong:text-slate-300 prose-li:text-slate-400
        prose-code:text-violet-300 prose-code:bg-zinc-800 prose-code:px-1 prose-code:rounded
        prose-a:text-violet-400">
        <ReactMarkdown>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
