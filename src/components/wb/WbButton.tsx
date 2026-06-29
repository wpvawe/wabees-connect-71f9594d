import { forwardRef, type ButtonHTMLAttributes } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNotch } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "facebook";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft",
  secondary: "bg-card text-foreground border border-border hover:bg-muted",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  facebook: "text-white shadow-soft hover:opacity-95",
};
const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export const WbButton = forwardRef<HTMLButtonElement, Props>(function WbButton(
  {
    variant = "primary",
    size = "md",
    loading,
    fullWidth,
    className,
    children,
    disabled,
    style,
    ...rest
  },
  ref,
) {
  const fbStyle = variant === "facebook" ? { backgroundColor: "#1877F2", ...style } : style;
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={fbStyle}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading && <FontAwesomeIcon icon={faCircleNotch} className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});
