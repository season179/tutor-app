import type { ReactNode } from "react";

import { classNames } from "../lib/class-names.js";

type PanelProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description: string;
  id: string;
  title: string;
};

export function Panel({ actions, children, className, description, id, title }: PanelProps) {
  return (
    <section className={classNames("panel", className)} aria-labelledby={id}>
      <div className="panel-heading">
        <div className="panel-heading-text">
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
        {actions ? <div className="panel-heading-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
