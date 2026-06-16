import type { ButtonHTMLAttributes, ReactNode } from "react";

import { classNames } from "../lib/class-names.js";

type ButtonIcon = "play" | "stop" | "send";

type ActionButtonProps = {
  children: ReactNode;
  icon?: ButtonIcon;
  variant: "primary" | "secondary";
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function ActionButton({
  children,
  className,
  icon,
  variant,
  type = "button",
  ...props
}: ActionButtonProps) {
  const variantClass = variant === "primary" ? "primary-action" : "secondary-action";

  return (
    <button className={classNames(variantClass, className)} type={type} {...props}>
      {icon ? <span className={`button-icon button-icon-${icon}`} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
