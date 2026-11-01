"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/ui/cn";

/** Drop react-markdown's `node` (and any className, ours wins) before spreading onto DOM elements. */
function strip<T extends object>(props: T): Omit<T, "node" | "className"> {
  const rest = { ...props } as T & { node?: unknown; className?: unknown };
  delete rest.node;
  delete rest.className;
  return rest;
}

const components: Components = {
  h1: (p) => <h2 className="mt-6 mb-2 text-lg font-semibold text-fg first:mt-0" {...strip(p)} />,
  h2: (p) => <h3 className="mt-5 mb-2 text-md font-semibold text-fg first:mt-0" {...strip(p)} />,
  h3: (p) => <h4 className="mt-4 mb-1.5 text-base font-semibold text-fg first:mt-0" {...strip(p)} />,
  h4: (p) => <h5 className="mt-4 mb-1.5 text-base font-medium text-fg first:mt-0" {...strip(p)} />,
  p: (p) => <p className="my-2.5 first:mt-0 last:mb-0" {...strip(p)} />,
  ul: ({ className, ...p }) => (
    <ul className={cn("my-2.5 flex flex-col gap-1 pl-5", className?.includes("contains-task-list") ? "list-none pl-0" : "list-disc")} {...strip(p)} />
  ),
  ol: (p) => <ol className="my-2.5 flex list-decimal flex-col gap-1 pl-5" {...strip(p)} />,
  li: ({ className, ...p }) => (
    <li className={cn("pl-0.5 marker:text-fg-subtle", className?.includes("task-list-item") && "flex items-start gap-2")} {...strip(p)} />
  ),
  input: ({ type, checked, ...p }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={checked} readOnly disabled className="mt-1 size-4 accent-(--accent)" {...strip(p)} />
    ) : (
      <input type={type} {...strip(p)} />
    ),
  a: (p) => (
    <a target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-fg-subtle underline-offset-2 hover:decoration-fg" {...strip(p)} />
  ),
  blockquote: (p) => <blockquote className="my-3 border-l-2 border-border-strong pl-3 text-fg-muted" {...strip(p)} />,
  code: ({ className, ...p }) => (
    <code className={cn("rounded-control bg-surface-2 px-1 py-0.5 text-[0.92em]", className)} {...strip(p)} />
  ),
  pre: (p) => (
    <pre className="my-3 overflow-x-auto rounded-control bg-surface-2 p-3 text-sm [&>code]:bg-transparent [&>code]:p-0" {...strip(p)} />
  ),
  hr: () => <hr className="my-5 border-border" />,
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...strip(p)} />
    </div>
  ),
  th: (p) => <th className="border-b border-border-strong px-2 py-1.5 text-left font-medium text-fg-muted" {...strip(p)} />,
  td: (p) => <td className="num border-b border-border px-2 py-1.5" {...strip(p)} />,
  img: ({ alt, ...p }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} className="my-3 max-w-full rounded-control" loading="lazy" {...strip(p)} />
  ),
};

/** Markdown preview styled with our tokens. Links open in a new tab (noopener). Raw HTML is not rendered. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-md leading-relaxed text-fg md:text-base", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
