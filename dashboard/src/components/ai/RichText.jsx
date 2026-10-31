import React from 'react';

/** Inline **bold** support without injecting HTML. */
const inline = (text, keyBase) => text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
  part.startsWith('**') && part.endsWith('**')
    ? <strong key={`${keyBase}-${i}`} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>
    : <React.Fragment key={`${keyBase}-${i}`}>{part}</React.Fragment>
);

/** Renders model output safely: paragraphs, "-"/"*"/"•" bullets, numbered lists, "#" headings, **bold**. */
export const RichText = ({ text, className = '' }) => {
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  String(text || '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) { flush(); return; }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const ordered = /^\d/.test(line);
      if (!list || list.ordered !== ordered) { flush(); list = { type: 'list', ordered, items: [] }; }
      list.items.push(bullet[1]);
      return;
    }
    flush();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push({ type: 'h', text: heading[1] });
    else blocks.push({ type: 'p', text: line });
  });
  flush();
  return (
    <div className={`space-y-2.5 text-[14px] leading-relaxed text-gray-200 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === 'h') return <h3 key={i} className="text-[13px] font-semibold text-gray-50 pt-1">{inline(b.text, i)}</h3>;
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return <Tag key={i} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 marker:text-terminal-muted`}>{b.items.map((it, j) => <li key={j}>{inline(it, `${i}-${j}`)}</li>)}</Tag>;
        }
        return <p key={i}>{inline(b.text, i)}</p>;
      })}
    </div>
  );
};

export default RichText;
