import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-accent text-accent-foreground border-transparent",
      outline: "border-border text-foreground",
      success: "bg-success/15 text-success border-success/40 dark:text-success",
      warning: "bg-warning/20 text-warning-foreground border-warning/50 dark:text-warning",
      danger: "bg-danger/15 text-danger border-danger/40 dark:text-danger",
      info: "bg-primary/15 text-primary border-primary/30",
      muted: "bg-muted text-muted-foreground border-transparent",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
