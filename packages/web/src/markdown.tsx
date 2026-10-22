import type { ReactNode } from "react";

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(<strong key={`${keyPrefix}-${index}`}>{token.slice(2, -2)}</strong>);
    else nodes.push(<code key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</code>);
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  const lines = markdown.split("\n");
  let list: string[] | null = null;
  const flush = (key: string) => {
    if (!list) return;
    const items = list;
    blocks.push(
      <ul key={key}>
        {items.map((item, index) => (
          <li key={`${key}-${index}`}>{inline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = null;
  };
  lines.forEach((line, index) => {
    const key = `md-${index}`;
    const image = /^!\[([^\]]*)\]\((https?:\/\/[^)]+|data:image\/[^)]+)\)$/.exec(line);
    if (image) {
      flush(`${key}-pre`);
      blocks.push(
        <p key={key}>
          <img alt={image[1] ?? ""} src={image[2] ?? ""} />
        </p>,
      );
      return;
    }
    if (line.startsWith("### ")) {
      flush(`${key}-pre`);
      blocks.push(<h3 key={key}>{inline(line.slice(4), key)}</h3>);
      return;
    }
    if (line.startsWith("## ")) {
      flush(`${key}-pre`);
      blocks.push(<h2 key={key}>{inline(line.slice(3), key)}</h2>);
      return;
    }
    if (line.startsWith("# ")) {
      flush(`${key}-pre`);
      blocks.push(<h1 key={key}>{inline(line.slice(2), key)}</h1>);
      return;
    }
    if (line.startsWith("> ")) {
      flush(`${key}-pre`);
      blocks.push(<blockquote key={key}>{inline(line.slice(2), key)}</blockquote>);
      return;
    }
    if (line === "---") {
      flush(`${key}-pre`);
      blocks.push(<hr key={key} />);
      return;
    }
    if (line.startsWith("- ")) {
      list ??= [];
      list.push(line.slice(2));
      return;
    }
    if (line.trim() === "") {
      flush(`${key}-blank`);
      return;
    }
    flush(`${key}-pre`);
    blocks.push(<p key={key}>{inline(line, key)}</p>);
  });
  flush("md-end");
  return <article className="md">{blocks}</article>;
}
