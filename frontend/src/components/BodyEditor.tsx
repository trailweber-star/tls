import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  PenLine,
  Quote,
  Table2,
} from "lucide-react";
import { articlesApi } from "../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Writing the article
 *
 * A plain textarea assumed whoever pastes into it knows markdown. Most
 * people do not, and "why is my bold showing as asterisks" is a fair
 * question to ask of a box with no buttons on it.
 *
 * What this is NOT is a what-you-see-is-what-you-get editor. Those work
 * by letting a browser generate HTML into a contenteditable div, and
 * what comes out of that is unpredictable markup which would then have
 * to survive our sanitiser — the same sanitiser that deliberately drops
 * style attributes and unknown tags. The result is an editor that
 * silently loses half of what it appeared to do.
 *
 * So the source stays exactly what it was — markdown, or HTML, both
 * accepted — and the buttons write it for you. Preview then renders
 * through the real server-side pipeline rather than a lookalike in the
 * browser, which means what it shows is what the page will show: the
 * same parser, the same sanitiser, the same dropped tags.
 * ------------------------------------------------------------------ */

/** The four the design system actually has. A free colour picker on a
 *  healthcare site produces hot-pink body copy by Friday. */
const COLOURS = [
  { key: "teal", label: "Teal", swatch: "#0a6f66" },
  { key: "navy", label: "Navy", swatch: "#061626" },
  { key: "muted", label: "Grey", swatch: "#55677a" },
  { key: "danger", label: "Red", swatch: "#d6455a" },
];

type Edit = { text: string; selectionStart: number; selectionEnd: number };

/** Wrap the selection, or drop a placeholder in and select it. */
function wrap(value: string, start: number, end: number, before: string, after: string, placeholder: string): Edit {
  const selected = value.slice(start, end) || placeholder;
  const text = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    text,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

/** Put a marker at the front of every line the selection touches. */
function prefixLines(value: string, start: number, end: number, marker: string | ((i: number) => string)): Edit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const to = value.indexOf("\n", end) === -1 ? value.length : value.indexOf("\n", end);
  const lines = value.slice(from, to).split("\n");
  const marked = lines
    .map((line, i) => {
      const m = typeof marker === "function" ? marker(i) : marker;
      // Clicking the same button twice takes the marker off again.
      return line.startsWith(m) ? line.slice(m.length) : m + line;
    })
    .join("\n");
  return {
    text: value.slice(0, from) + marked + value.slice(to),
    selectionStart: from,
    selectionEnd: from + marked.length,
  };
}

/**
 * Drop a block in on its own lines, with blank lines around it.
 *
 * Inserted after whatever is selected rather than over it: a table
 * button that silently ate the paragraph somebody had highlighted would
 * be a very unpleasant surprise.
 */
function insertBlock(value: string, _start: number, end: number, block: string): Edit {
  const before = value.slice(0, end).replace(/\n*$/, "");
  const after = value.slice(end).replace(/^\n*/, "");
  const lead = before ? `${before}\n\n` : "";
  const text = `${lead}${block}${after ? `\n\n${after}` : "\n"}`;
  return { text, selectionStart: lead.length, selectionEnd: lead.length + block.length };
}

const TABLE = ["| Option | What it means |", "| --- | --- |", "| First | Describe it here |", "| Second | And here |"].join(
  "\n"
);

export function BodyEditor({
  value,
  onChange,
  format = "auto",
  rows = 16,
}: {
  value: string;
  onChange: (next: string) => void;
  format?: "auto" | "markdown" | "html";
  rows?: number;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [html, setHtml] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [colourOpen, setColourOpen] = useState(false);

  const apply = useCallback(
    (fn: (value: string, start: number, end: number) => Edit) => {
      const el = area.current;
      if (!el) return;
      const { selectionStart, selectionEnd } = el;
      const next = fn(el.value, selectionStart, selectionEnd);
      onChange(next.text);
      // Restored after React has written the new value, or the caret
      // jumps to the end and the next click formats the wrong thing.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    },
    [onChange]
  );

  /* Rendered by the server so the preview cannot drift from the page:
     same parser, same sanitiser, same allow-list. */
  useEffect(() => {
    if (tab !== "preview") return;
    let alive = true;
    setRendering(true);
    setProblem(null);
    articlesApi
      .preview(value, format)
      .then((res) => alive && setHtml(res.html))
      .catch((e) => alive && setProblem(e instanceof Error ? e.message : "Could not render that."))
      .finally(() => alive && setRendering(false));
    return () => {
      alive = false;
    };
  }, [tab, value, format]);

  const btn =
    "grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition hover:bg-white hover:text-ink hover:shadow-sm";

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-bold text-ink">Body</span>
        <span className="text-[12px] text-ink-faint">
          Markdown or HTML — both work. {words > 0 && `${words} words`}
        </span>
      </div>

      <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-paper-muted px-2 py-1.5">
          <ToolButton
            label="Bold"
            className={btn}
            onClick={() => apply((v, s, e) => wrap(v, s, e, "**", "**", "bold text"))}
          >
            <Bold className="h-4 w-4" strokeWidth={2.4} />
          </ToolButton>
          <ToolButton
            label="Italic"
            className={btn}
            onClick={() => apply((v, s, e) => wrap(v, s, e, "_", "_", "italic text"))}
          >
            <Italic className="h-4 w-4" strokeWidth={2.4} />
          </ToolButton>
          <ToolButton
            label="Highlight"
            className={btn}
            onClick={() => apply((v, s, e) => wrap(v, s, e, "<mark>", "</mark>", "highlighted"))}
          >
            <Highlighter className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>

          {/* Colour, from the palette the site already uses. */}
          <div className="relative">
            <button
              type="button"
              title="Text colour"
              aria-label="Text colour"
              onClick={() => setColourOpen((v) => !v)}
              className={`${btn} ${colourOpen ? "bg-white text-ink shadow-sm" : ""}`}
            >
              <span className="grid h-4 w-4 place-items-center text-[12px] font-black leading-none">A</span>
              <span className="sr-only">Text colour</span>
            </button>
            {colourOpen && (
              <div className="absolute left-0 top-9 z-20 w-36 rounded-xl border border-line bg-white py-1 shadow-lg">
                {COLOURS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setColourOpen(false);
                      apply((v, s, e) => wrap(v, s, e, `<span class="c-${c.key}">`, "</span>", "coloured text"));
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-semibold text-ink transition hover:bg-paper-tint"
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full ring-1 ring-line"
                      style={{ background: c.swatch }}
                      aria-hidden
                    />
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Divider />

          <ToolButton
            label="Heading"
            className={btn}
            onClick={() => apply((v, s, e) => prefixLines(v, s, e, "## "))}
          >
            <Heading2 className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Sub-heading"
            className={btn}
            onClick={() => apply((v, s, e) => prefixLines(v, s, e, "### "))}
          >
            <Heading3 className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Bulleted list"
            className={btn}
            onClick={() => apply((v, s, e) => prefixLines(v, s, e, "- "))}
          >
            <List className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            className={btn}
            onClick={() => apply((v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `))}
          >
            <ListOrdered className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton label="Quote" className={btn} onClick={() => apply((v, s, e) => prefixLines(v, s, e, "> "))}>
            <Quote className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>

          <Divider />

          <ToolButton
            label="Link"
            className={btn}
            onClick={() =>
              apply((v, s, e) => {
                const selected = v.slice(s, e) || "link text";
                const text = `${v.slice(0, s)}[${selected}](https://)${v.slice(e)}`;
                // Caret lands after "https://", ready for the address.
                const at = s + selected.length + 11;
                return { text, selectionStart: at, selectionEnd: at };
              })
            }
          >
            <Link2 className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Image"
            className={btn}
            onClick={() => apply((v, s, e) => insertBlock(v, s, e, "![What the picture shows](https://)"))}
          >
            <ImageIcon className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton label="Table" className={btn} onClick={() => apply((v, s, e) => insertBlock(v, s, e, TABLE))}>
            <Table2 className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Code"
            className={btn}
            onClick={() => apply((v, s, e) => wrap(v, s, e, "`", "`", "code"))}
          >
            <Code2 className="h-4 w-4" strokeWidth={2.2} />
          </ToolButton>
          <ToolButton
            label="Divider"
            className={btn}
            onClick={() => apply((v, s, e) => insertBlock(v, s, e, "---"))}
          >
            <Minus className="h-4 w-4" strokeWidth={2.4} />
          </ToolButton>

          <div className="ml-auto flex items-center gap-1 rounded-lg bg-white p-0.5 ring-1 ring-line">
            {(["write", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-bold transition ${
                  tab === t ? "bg-navy-950 text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                {t === "write" ? <PenLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {t === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
        </div>

        {tab === "write" ? (
          <textarea
            ref={area}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // The two shortcuts everybody's fingers already know.
              if (!(e.metaKey || e.ctrlKey)) return;
              if (e.key === "b") {
                e.preventDefault();
                apply((v, s, en) => wrap(v, s, en, "**", "**", "bold text"));
              }
              if (e.key === "i") {
                e.preventDefault();
                apply((v, s, en) => wrap(v, s, en, "_", "_", "italic text"));
              }
            }}
            rows={rows}
            placeholder={"## A heading\n\nParagraph text, **bold**, [links](https://example.com) and lists. Paste from anywhere — the formatting is kept."}
            className="block w-full resize-y border-0 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:ring-0"
          />
        ) : (
          <div className="px-4 py-4" style={{ minHeight: `${rows * 1.5}rem` }}>
            {rendering && !html ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-faint">
                <Loader2 className="h-4 w-4 animate-spin" /> Rendering…
              </p>
            ) : problem ? (
              <p className="text-[13px] font-semibold text-danger">{problem}</p>
            ) : html ? (
              <article className="prose-tls max-w-[68ch]" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="text-[13px] text-ink-faint">Nothing to show yet.</p>
            )}
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[12px] text-ink-faint">
        Preview renders through the live site's own formatter, so anything it drops here would have been dropped
        on the page too.
      </p>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" aria-hidden />;
}

function ToolButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={className}>
      {children}
    </button>
  );
}
