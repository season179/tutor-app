type ClassNameValue = string | false | null | undefined;

export function classNames(...values: ClassNameValue[]): string {
  return values.filter(Boolean).join(" ");
}
