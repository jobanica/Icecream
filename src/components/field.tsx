import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Label + input pair for admin forms */
export function Field({
  label,
  name,
  className,
  hint,
  ...props
}: React.ComponentProps<"input"> & { label: string; name: string; hint?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  className,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
