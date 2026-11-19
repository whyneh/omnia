import { marked } from "marked";
import DOMPurify from "dompurify";
import { useMemo } from "react";

marked.setOptions({ gfm: true, breaks: true });

/** Split YAML frontmatter off a markdown document. */
export function splitFrontmatter(text: string): { fm: [string, string][]; body: string } {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: [], body: text };
  const fm: [string, string][] = [];
  let last: [string, string] | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const v = kv[2].trim();
      last = [kv[1], /^[>|]-?$/.test(v) ? "" : v.replace(/^["']|["']$/g, "")];
      fm.push(last);
    } else if (last && /^\s/.test(line)) {
      last[1] = (last[1] ? last[1] + " " : "") + line.trim();
    }
  }
  return { fm, body: m[2] };
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { async: false }) as string;
    const safe = DOMPurify.sanitize(raw, {
      FORBID_TAGS: ["style", "form", "input", "iframe"],
      RETURN_DOM_FRAGMENT: true,
    });
    const content = document.createElement("div");
    content.append(safe);
    for (const table of content.querySelectorAll("table")) {
      const scroll = document.createElement("div");
      scroll.className = "md-table-scroll";
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", "表格（可横向滚动）");
      table.replaceWith(scroll);
      scroll.append(table);
    }
    return content.innerHTML;
  }, [text]);
  return <div className={`md ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Markdown doc with its frontmatter shown as a key/value table. */
export function Doc({ text, path }: { text: string; path: string }) {
  const lower = path.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) {
    return <pre className="code">{text}</pre>;
  }
  const { fm, body } = splitFrontmatter(text);
  return (
    <>
      {fm.length > 0 && (
        <table className="fm">
          <tbody>
            {fm.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Markdown text={body} />
    </>
  );
}
