"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cx } from "@/components/ui";

/**
 * Safe Markdown rendering for AI output: raw HTML is never rendered (react-markdown default),
 * formulas use KaTeX, and [S1]-style citations become highlighter marks that jump to the source.
 */
export function Markdown({
  children,
  className,
  onCite,
  citeTitles,
  streaming,
}: {
  children: string;
  className?: string;
  onCite?: (label: string) => void;
  citeTitles?: Record<string, string>;
  streaming?: boolean;
}) {
  // Turn [S1] into a link we can render as a citation mark. Normalise \( \) and \[ \] math.
  const prepared = children
    .replace(/\[(S\d+)\](?!\()/g, "[$1](#cite-$1)")
    .replace(/\\\((.+?)\\\)/g, (_m, inner: string) => `$${inner}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => `$$${inner}$$`);

  return (
    <div className={cx("reading", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          a: ({ href, children: linkChildren, ...props }) => {
            const cite = href?.match(/^#cite-(S\d+)$/)?.[1];
            if (cite) {
              return (
                <a
                  href={`#source-${cite}`}
                  className="cite"
                  title={citeTitles?.[cite] ?? `Source ${cite}`}
                  onClick={(e) => {
                    if (onCite) {
                      e.preventDefault();
                      onCite(cite);
                    }
                  }}
                >
                  {cite}
                </a>
              );
            }
            const external = href && /^https?:/i.test(href);
            return (
              <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})} {...props}>
                {linkChildren}
              </a>
            );
          },
          img: () => null, // never load remote images from model output
        }}
      >
        {prepared}
      </ReactMarkdown>
      {streaming && <span className="caret" aria-hidden />}
    </div>
  );
}
