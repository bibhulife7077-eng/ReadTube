import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="26"
        height="22"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M16 7.5v17"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.55"
      />
      <path
        d="M16 10c-3.2 1.6-6.4 1.6-9.5 0v11.2c3.1 1.7 6.3 1.7 9.5 0V10Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M16 10c3.2 1.6 6.4 1.6 9.5 0v11.2c-3.1 1.7-6.3 1.7-9.5 0V10Z"
        fill="currentColor"
        opacity="0.08"
      />
    </svg>
  );
}

export function Wordmark({
  className,
  to = "/",
}: {
  className?: string;
  to?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 text-fg no-underline hover:opacity-80",
        className,
      )}
    >
      <Mark />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-display text-[1.05rem] tracking-tight sm:text-lg">
          Read<span className="text-muted">Tube</span>
        </span>
        <span className="mt-1 text-[10px] font-medium tracking-[0.14em] text-muted">
          Video as books
        </span>
      </span>
    </Link>
  );
}
