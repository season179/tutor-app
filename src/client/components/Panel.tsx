import type { ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  className?: string;
  description: string;
  id: string;
  title: string;
};

export function Panel({ children, className, description, id, title }: PanelProps) {
  return (
    <section className={["panel", className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <div className="panel-heading">
        <span className="panel-knot" aria-hidden="true" />
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
