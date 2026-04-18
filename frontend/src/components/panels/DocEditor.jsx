export default function DocEditor({ content, onChange }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <textarea
        className="flex-1 w-full bg-[#0f1117] text-slate-300 text-[13px] font-mono
          p-4 resize-none border-none outline-none
          placeholder:text-slate-600"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write your screen documentation here..."
        spellCheck={false}
      />
    </div>
  );
}
