import { CodeBlock } from "@workspace/web-design-system/typography/code-block";

export function CodePanel({
  ariaLabel,
  children,
  language = "text",
}: {
  ariaLabel: string;
  children: string;
  language?: string;
}) {
  return (
    <CodeBlock aria-label={ariaLabel} className="w-full min-w-0">
      <CodeBlock.Header>
        <CodeBlock.Filename>{ariaLabel}</CodeBlock.Filename>
        <CodeBlock.CopyButton code={children} />
      </CodeBlock.Header>
      <CodeBlock.Code
        aria-label={`${ariaLabel} code`}
        className="max-h-[30rem] overflow-auto"
        tabIndex={0}
        code={children}
        language={language}
      />
    </CodeBlock>
  );
}
