import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-8 w-full rounded-md border border-input bg-card px-2.5 py-1 text-[13px] shadow-xs placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("flex min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] placeholder:text-muted-foreground", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground", className)} {...props} />;
}

/** Amount input: keeps text while typing, validates on blur, always shows 2 decimals. */
export function MoneyInput({
  valuePaise,
  onChangePaise,
  className,
  ref,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { valuePaise: number; onChangePaise: (p: number) => void; ref?: React.Ref<HTMLInputElement> }) {
  const [text, setText] = React.useState(() => (valuePaise === 0 ? "" : plain(valuePaise)));
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    setText((t) => (parseLoose(t) === valuePaise ? t : valuePaise === 0 ? "" : plain(valuePaise)));
  }, [valuePaise]);
  return (
    <Input
      ref={ref}
      inputMode="decimal"
      className={cn("num text-right", invalid && "border-danger ring-1 ring-danger", className)}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const p = parseLoose(t);
        if (p === null) setInvalid(true);
        else {
          setInvalid(false);
          onChangePaise(p);
        }
      }}
      onBlur={() => {
        const p = parseLoose(text);
        if (p !== null) setText(p === 0 ? "" : plain(p));
      }}
      onFocus={(e) => e.target.select()}
      {...props}
    />
  );
}

import { Money } from "@/lib/money";
const plain = (p: number) => Money.plain(p);
const parseLoose = (t: string) => Money.tryParse(t);
