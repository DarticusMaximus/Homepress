import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type IssueMarkdownProps = {
  markdown: string;
  className?: string;
};

const markdownComponents: Components = {
  a: ({ href, children, node: _node, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children, node: _node, ...props }) => (
    <div className="w-full overflow-x-auto">
      <table {...props}>{children}</table>
    </div>
  ),
};

export function IssueMarkdown({ markdown, className }: IssueMarkdownProps) {
  return (
    <div
      className={cn(
        "prose dark:prose-invert w-full prose-img:max-w-full",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
