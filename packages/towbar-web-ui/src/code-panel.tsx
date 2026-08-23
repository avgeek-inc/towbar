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
    <CodeBlock
      aria-label={ariaLabel}
      className="max-h-[34rem] w-full min-w-0 overflow-auto"
    >
      <CodeBlock.Header>
        <CodeBlock.Filename>{ariaLabel}</CodeBlock.Filename>
        <CodeBlock.CopyButton code={children} />
      </CodeBlock.Header>
      <CodeBlock.Code code={children} language={language} />
    </CodeBlock>
  );
}
