import type { ComponentProps, ReactNode } from "react";

/** Joins class names, skipping empty values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "bg-accent text-accent-ink hover:bg-[color-mix(in_srgb,var(--accent),black_12%)]",
  secondary: "border border-line hover:bg-surface",
  danger: "bg-danger-ink text-bg hover:opacity-90",
  dangerOutline: "border border-danger-ink text-danger-ink hover:bg-danger-bg",
} as const;

// The px minimum keeps buttons at least 44px tall even at the Smaller text size, where rem
// padding shrinks. At Normal and Larger they are already taller, so nothing changes there.
const buttonSizes = {
  lg: "min-h-[44px] px-7 py-3 text-lg",
  md: "min-h-[44px] px-6 py-3",
  sm: "min-h-[44px] px-5 py-2.5",
  xs: "px-4 py-2 text-sm",
} as const;

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

/** The one button style used across Haven. Defaults to type="button" so it never submits a form by accident. */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "rounded-lg font-medium transition-[background-color,opacity,transform] duration-150 ease-out active:translate-y-px disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

const fieldBase = "border border-line py-3 placeholder:text-muted";
const fieldTones = { surface: "bg-surface", bg: "bg-bg" } as const;
const fieldRadii = {
  xl: "rounded-xl px-4",
  "2xl": "rounded-2xl px-4",
  full: "rounded-full px-5",
} as const;

type FieldStyle = {
  /** Background: "surface" on the page, "bg" inside cards. */
  tone?: keyof typeof fieldTones;
  radius?: keyof typeof fieldRadii;
};

function fieldClass({
  tone = "surface",
  radius = "xl",
  className,
}: FieldStyle & { className?: string }) {
  return cx(fieldBase, fieldTones[tone], fieldRadii[radius], className);
}

export function Input({ tone, radius, className, ...props }: ComponentProps<"input"> & FieldStyle) {
  return <input className={fieldClass({ tone, radius, className })} {...props} />;
}

export function Textarea({
  tone,
  radius,
  className,
  ...props
}: ComponentProps<"textarea"> & FieldStyle) {
  return <textarea className={fieldClass({ tone, radius, className })} {...props} />;
}

export function Select({
  tone,
  radius,
  className,
  ...props
}: ComponentProps<"select"> & FieldStyle) {
  return <select className={fieldClass({ tone, radius, className })} {...props} />;
}

const tagKinds = {
  private: { label: "Private · on your device", style: "bg-accent-soft text-ink" },
  cloud: { label: "Cloud · asks you first", style: "bg-warn-bg text-warn-ink" },
  /** Beside a chat reply that the cloud model wrote, after the person agreed. */
  cloudReply: { label: "Cloud · you agreed", style: "bg-warn-bg text-warn-ink" },
} as const;

/** Says where a feature runs. The words carry the meaning, so it never relies on colour alone. */
export function Tag({ kind }: { kind: keyof typeof tagKinds }) {
  const t = tagKinds[kind];
  return (
    <span className={cx("rounded-md px-2 py-0.5 text-sm font-medium whitespace-nowrap", t.style)}>
      {t.label}
    </span>
  );
}

/** A page's h1 with the where-it-runs tag beside it. */
export function PageTitle({
  where,
  className,
  centered = false,
  children,
}: {
  where: keyof typeof tagKinds;
  className?: string;
  /** Centre the title and its tag (and keep them centred when they wrap onto two lines). */
  centered?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("flex flex-wrap items-center gap-x-3 gap-y-2", centered && "justify-center")}
    >
      <h1 className={cx("tracking-tight", className ?? "text-3xl")}>{children}</h1>
      <Tag kind={where} />
    </div>
  );
}
