import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Assistant replies are markdown: paragraphs, bold, lists and small tables
// (a price list). react-markdown builds React elements and ignores raw HTML,
// so model output can't inject markup or scripts.
const components: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-3">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 first:mt-0">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
      {children}
    </a>
  ),
  h1: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  code: ({ children }) => <code className="rounded bg-surface px-1 py-0.5 text-[14px]">{children}</code>,
  // Wide tables scroll inside the bubble instead of widening the page.
  // wrap-break-word overrides a container's overflow-wrap:anywhere, which would
  // let a cell shrink to one letter wide ("$3 / 49") instead of scrolling.
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface text-[14px] wrap-break-word first:mt-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border bg-bg text-[13px] text-text-muted">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
  th: ({ children, style }) => (
    <th className="px-4 py-2.5 font-medium" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-4 py-2.5" style={style}>
      {children}
    </td>
  ),
};

const plugins = [remarkGfm];

// Parsing is the expensive part; re-parse only when the text changes.
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});
