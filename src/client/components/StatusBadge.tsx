import type { StatusTone } from "../types.js";

type StatusBadgeProps = {
  message: string;
  tone: StatusTone;
};

export function StatusBadge({ message, tone }: StatusBadgeProps) {
  return (
    <p className="status" data-tone={tone}>
      {message}
    </p>
  );
}
