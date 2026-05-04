import { cn } from "@/lib/utils";

export type DotVariant = "ok" | "warn" | "err" | "empty";

export function StatusDot({
  variant,
  className,
}: {
  variant: DotVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        variant === "ok" &&
          "bg-ok shadow-[0_0_6px_rgba(95,167,94,0.6)]",
        variant === "warn" && "bg-warn",
        variant === "err" && "bg-err",
        variant === "empty" && "border border-fg-4 bg-transparent",
        className,
      )}
    />
  );
}
