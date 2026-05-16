import { useEffect, useRef } from "react";
import { findHookEvent, type HookEvent } from "@/lib/catalog";
import { parseMatcherGroups, type ParsedMatcherGroup } from "@/lib/hooks";
import type { Row } from "@/lib/rows";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./SourceBadge";

/**
 * Drill-down for `hooks.<EventName>` rows. Renders matcher groups,
 * per-handler implementation (the impl that can't fit in the drawer),
 * and the upstream event schema from the hooks catalog.
 *
 * Opening a modal is reserved for the "details" surface — the drawer
 * already shows the summary view, so users only land here when they
 * specifically want the full impl. Esc closes (wired in InspectorShell
 * alongside the other modal panels).
 */
export function HookDetailsModal({
  row,
  onClose,
}: {
  row: Row;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Parsed defensively against malformed values — see lib/hooks.ts.
  const groups = parseMatcherGroups(row.value);
  // The keyPath shape is enforced by the caller (InspectorShell only
  // opens this modal for hookEventNameFromKeyPath matches), so the
  // split + lookup are safe here.
  const eventName = row.keyPath.startsWith("hooks.")
    ? row.keyPath.slice("hooks.".length)
    : row.keyPath;
  const event = findHookEvent(eventName);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${row.keyPath} details`}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg-0/95 backdrop-blur-sm"
    >
      <header className="flex h-[38px] shrink-0 items-center border-b border-line-strong bg-bg-1 px-4">
        <span className="font-mono text-[12.5px] font-semibold tracking-tight text-fg-1">
          {row.keyPath}
        </span>
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-4">
          hook details
        </span>
        {row.winner && (
          <span className="ml-3 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.05em] text-fg-3">
            <SourceBadge source={row.winner} />
            <span>wins</span>
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-sm border border-line-strong px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-fg-2 hover:border-accent hover:text-fg-1"
          autoFocus
        >
          esc · close
        </button>
      </header>

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="scrollbar flex-1 overflow-auto outline-none"
      >
        <div className="mx-auto max-w-4xl px-8 pt-8 pb-16">
          <TriggersSection event={event} />
          <MatcherGroupsSection groups={groups} />
          <EventSchemaSection event={event} />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between border-b border-line-strong pb-1.5">
        <h2 className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-fg-1">
          {title}
        </h2>
        {note && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-4">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function TriggersSection({ event }: { event: HookEvent | null }) {
  if (!event) {
    return (
      <Section title="Triggers" note="from hooks catalog">
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-3">
          This event isn't documented in the upstream hooks catalog.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Triggers" note="from hooks catalog">
      <p className="font-mono text-[12.5px] leading-relaxed text-fg-2">
        {event.when}
      </p>
    </Section>
  );
}

function MatcherGroupsSection({ groups }: { groups: ParsedMatcherGroup[] }) {
  if (groups.length === 0) {
    return (
      <Section title="Matcher groups">
        <p className="font-mono text-[11.5px] leading-relaxed text-fg-3">
          No matcher groups configured for this event.
        </p>
      </Section>
    );
  }
  return (
    <Section
      title="Matcher groups"
      note={`${groups.length} configured`}
    >
      <ol className="space-y-5">
        {groups.map((group, i) => (
          <li
            key={i}
            className="rounded-sm border border-line bg-bg-1 px-4 py-3"
          >
            <div className="mb-3 flex items-baseline gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg-4">
                Group {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[12px] text-fg-2">
                matcher:{" "}
                {group.matcher === null ? (
                  <span className="text-fg-4">(any)</span>
                ) : (
                  <code className="rounded-[2px] bg-bg-2 px-1 py-px text-fg-1">
                    {group.matcher}
                  </code>
                )}
              </span>
            </div>
            <HandlerList handlers={group.handlers} />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function HandlerList({ handlers }: { handlers: ParsedMatcherGroup["handlers"] }) {
  if (handlers.length === 0) {
    return (
      <p className="font-mono text-[11.5px] leading-snug text-fg-4">
        No handlers in this group.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {handlers.map((h, i) => (
        <div
          key={i}
          className="rounded-sm border border-line bg-bg-0 px-3 py-2.5"
        >
          <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-fg-3">
            <span className="text-fg-4">Handler {i + 1}</span>
            <TypeChip type={h.type} />
          </div>
          <HandlerFields raw={h.raw} />
        </div>
      ))}
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-[2px] border px-1.5 py-0.5",
        "font-mono text-[10px] uppercase tracking-[0.05em]",
        "border-line-strong text-fg-1 bg-bg-2",
      )}
    >
      {type}
    </span>
  );
}

// Render every field on the handler. Skip `type` (shown as the chip).
// Long string fields (`command`, `prompt`, `url`) render as preformatted
// blocks so newlines and quoting are preserved. Other fields render as
// `key: value` inline.
function HandlerFields({ raw }: { raw: Record<string, unknown> }) {
  const entries = Object.entries(raw).filter(([k]) => k !== "type");
  if (entries.length === 0) {
    return (
      <p className="font-mono text-[11px] text-fg-4">
        (no fields beyond `type`)
      </p>
    );
  }
  return (
    <dl className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[88px_1fr] gap-x-3 items-baseline">
          <dt className="font-mono text-[10.5px] uppercase tracking-wider text-fg-4">
            {k}
          </dt>
          <dd>
            <FieldValue value={v} multiline={isLongStringKey(k)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function isLongStringKey(key: string): boolean {
  // These fields commonly contain multi-line shell snippets or long
  // prompt prose; render them with the preformatted treatment.
  return key === "command" || key === "prompt" || key === "url";
}

function FieldValue({
  value,
  multiline,
}: {
  value: unknown;
  multiline: boolean;
}) {
  if (typeof value === "string") {
    if (multiline) {
      return (
        <pre
          className={cn(
            "rounded-[2px] bg-bg-2 px-2 py-1.5",
            "font-mono text-[11.5px] leading-relaxed text-fg-1",
            "whitespace-pre-wrap break-all",
          )}
        >
          {value}
        </pre>
      );
    }
    return (
      <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
        {value}
      </code>
    );
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return (
      <code className="rounded-[2px] bg-bg-2 px-1 py-px font-mono text-[11.5px] text-fg-1">
        {String(value)}
      </code>
    );
  }
  // Arrays / nested objects: JSON-stringify into a pre block.
  return (
    <pre
      className={cn(
        "rounded-[2px] bg-bg-2 px-2 py-1.5",
        "font-mono text-[11px] leading-relaxed text-fg-2",
        "whitespace-pre-wrap break-all",
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EventSchemaSection({ event }: { event: HookEvent | null }) {
  if (!event) return null;
  const inputFields = Array.isArray(event.inputFields)
    ? (event.inputFields as Array<{ field?: string; description?: string }>)
    : [];
  const outputFields = Array.isArray(event.outputFields)
    ? (event.outputFields as Array<{ field?: string; description?: string }>)
    : [];
  const hasAny =
    inputFields.length > 0 ||
    outputFields.length > 0 ||
    typeof event.inputExample === "string";
  if (!hasAny) return null;
  return (
    <Section title="Event schema" note="from hooks catalog">
      {inputFields.length > 0 && (
        <FieldTable label="Input fields" fields={inputFields} />
      )}
      {outputFields.length > 0 && (
        <FieldTable label="Output fields" fields={outputFields} />
      )}
      {typeof event.inputExample === "string" && event.inputExample.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
            Example input
          </h3>
          <pre className="scrollbar overflow-x-auto rounded-sm border border-line bg-bg-1 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-2">
            {event.inputExample}
          </pre>
        </div>
      )}
    </Section>
  );
}

function FieldTable({
  label,
  fields,
}: {
  label: string;
  fields: Array<{ field?: string; description?: string }>;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-fg-3">
        {label}
      </h3>
      <dl className="grid grid-cols-[200px_1fr] gap-x-4 gap-y-1.5">
        {fields.map((f, i) => (
          <div key={`${f.field ?? "_"}-${i}`} className="contents">
            <dt>
              <code className="font-mono text-[11px] text-fg-1">
                {f.field ?? "—"}
              </code>
            </dt>
            <dd className="font-mono text-[11px] leading-snug text-fg-2">
              {f.description ?? ""}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
