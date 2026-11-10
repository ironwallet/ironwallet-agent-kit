import en from "./en.json";

export type MessageKey = keyof typeof en;

/**
 * Keys and `{placeholder}` syntax follow the mobile app's ARB files so their
 * translations can be imported later. English is the only locale for now.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
