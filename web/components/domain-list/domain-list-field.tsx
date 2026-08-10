import type { ReactNode } from "react";

type DomainListFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function DomainListField({
  label,
  children,
  className,
}: DomainListFieldProps): React.JSX.Element {
  return (
    <div className={className}>
      <span className="text-muted-foreground">{`${label}: `}</span>
      {children}
    </div>
  );
}
