import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide, ...props }: DialogPrimitive.DialogContentProps & { title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card text-card-foreground shadow-2xl focus:outline-none flex flex-col max-h-[92vh]",
          wide ? "w-[min(1100px,94vw)]" : "w-[min(560px,94vw)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex items-center justify-end gap-2", className)} {...props} />;
}
