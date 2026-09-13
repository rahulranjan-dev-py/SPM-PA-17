import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useUiStore } from "@/store/ui";
import { cn } from "@/lib/utils";

const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4500}>
      {toasts.map((t) => {
        const Icon = icons[t.kind];
        return (
          <ToastPrimitive.Root
            key={t.id}
            onOpenChange={(open) => !open && dismiss(t.id)}
            className={cn(
              "flex items-start gap-2 rounded-md border bg-card px-3 py-2 shadow-lg text-[13px] data-[state=open]:animate-in data-[state=open]:slide-in-from-right-4",
              t.kind === "error" && "border-danger/50",
              t.kind === "success" && "border-success/50",
              t.kind === "warning" && "border-warning/60",
            )}
          >
            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", t.kind === "error" && "text-danger", t.kind === "success" && "text-success", t.kind === "warning" && "text-warning-foreground dark:text-warning", t.kind === "info" && "text-primary")} />
            <div>
              <ToastPrimitive.Title className="font-medium">{t.title}</ToastPrimitive.Title>
              {t.description && <ToastPrimitive.Description className="text-muted-foreground text-xs mt-0.5">{t.description}</ToastPrimitive.Description>}
            </div>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-8 right-3 z-[80] flex w-80 flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
