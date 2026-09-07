import {
  parseTree,
  getNodeValue,
  type Node,
  type ParseError,
} from "jsonc-parser";
export const lower = (value: string) => value.toLowerCase();
export async function hash(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function parseStrict(text: string): unknown {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!root || errors.length) throw new Error("invalid_json");
  const visit = (node: Node) => {
    if (node.type === "object") {
      const keys = new Set();
      for (const child of node.children ?? []) {
        const key = child.children?.[0]?.value;
        if (keys.has(key)) throw new Error("duplicate_json_key");
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return getNodeValue(root);
}
export const code = (error: unknown): string =>
  error instanceof Error && /^[a-z0-9_:.-]{1,100}$/i.test(error.message)
    ? error.message
    : "unexpected_error";
export function githubUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password
    )
      return "";
    url.search = "";
    return url.href;
  } catch {
    return "";
  }
}
export const encodeRepo = (name: string) =>
  name.split("/").map(encodeURIComponent).join("/");
export function textBound(value: unknown, limit = 4000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit);
}
export function safePath(path: string): boolean {
  return (
    !!path &&
    !path.startsWith("/") &&
    !path.split("/").some((p) => p === ".." || p === ".") &&
    !/[\0\\?#]/.test(path)
  );
}
