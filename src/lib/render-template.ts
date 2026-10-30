import { escapeHtml } from './tracker';

// Merge tags: {{ name }} or {{ name | fallback text }}.
// Names may be dotted ({{ company.name }}) to reach into nested values.
const TAG_PATTERN = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export type TemplateVariables = Record<string, unknown>;

function lookup(variables: TemplateVariables, path: string): unknown {
  let value: unknown = variables;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Replaces merge tags with values. In HTML mode values are escaped so a
 * contact's name cannot inject markup. Missing values use the fallback, or
 * an empty string.
 */
export function renderTemplate(source: string, variables: TemplateVariables, mode: 'html' | 'text'): string {
  return source.replace(TAG_PATTERN, (_match, name: string, fallback?: string) => {
    const value = lookup(variables, name);
    const resolved = value === undefined || value === null || value === '' ? (fallback ?? '') : String(value);
    return mode === 'html' ? escapeHtml(resolved) : resolved;
  });
}

/** Tag names used in a template, for showing which variables it expects. */
export function templateTags(...sources: Array<string | null | undefined>): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of (source ?? '').matchAll(TAG_PATTERN)) names.add(match[1]);
  }
  return Array.from(names).sort();
}

export function hasMergeTags(source: string | null | undefined): boolean {
  return Boolean(source && /\{\{\s*[a-zA-Z_][\w.]*\s*(?:\|[^}]*)?\}\}/.test(source));
}

/** Plain-text version of an HTML email, for the text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Variables available for a contact: built-ins plus custom attributes. */
export function contactVariables(contact: {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  attributes?: Record<string, unknown> | null;
} | undefined, email: string): TemplateVariables {
  const firstName = contact?.first_name ?? '';
  const lastName = contact?.last_name ?? '';
  return {
    ...(contact?.attributes ?? {}),
    email,
    first_name: firstName,
    last_name: lastName,
    full_name: [firstName, lastName].filter(Boolean).join(' '),
  };
}
