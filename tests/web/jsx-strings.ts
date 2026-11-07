/**
 * Agent H — user-facing string literals in a .tsx file, found by parsing the
 * file with the TypeScript compiler (not by regex):
 *  - JsxText nodes;
 *  - string / no-substitution template literals anywhere under a JSX element
 *    or fragment, except structural attributes (className, key, href, …);
 *  - string literals assigned to prose-named properties anywhere in the file
 *    (label, eyebrow, sentence, title, reason, unit, value, aria-label);
 *  - the literal spans of template expressions under JSX.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const STRUCTURAL_ATTRS = new Set(['className', 'key', 'href', 'id', 'type', 'rel', 'target', 'accept', 'pattern', 'step', 'min', 'max', 'role', 'style', 'size', 'dateTime', 'htmlFor', 'name', 'lang', 'crossOrigin', 'download']);
const PROSE_PROPS = new Set(['label', 'eyebrow', 'sentence', 'title', 'reason', 'unit', 'value', 'aria-label', 'placeholder', 'summary', 'message']);

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function underJsx(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p)) return true;
    p = p.parent;
  }
  return false;
}

function attributeName(node: ts.Node): string | undefined {
  let p: ts.Node | undefined = node.parent;
  while (p && !ts.isJsxAttribute(p) && !ts.isJsxElement(p) && !ts.isJsxExpression(p)) p = p.parent;
  if (p && ts.isJsxAttribute(p)) return p.name.getText();
  // {cond ? 'a' : 'b'} inside an attribute expression
  if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)) return p.parent.name.getText();
  return undefined;
}

export function jsxStrings(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = new Set<string>();
  const add = (s: string): void => {
    const t = norm(s);
    if (t && /[A-Za-z]{2,}/.test(t)) out.add(t);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add(node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (ts.isPropertyAssignment(parent) && PROSE_PROPS.has(parent.name.getText().replace(/['"]/g, ''))) add(node.text);
      else if (underJsx(node)) {
        if (ts.isImportDeclaration(parent)) return;
        const attr = attributeName(node);
        if (attr && STRUCTURAL_ATTRS.has(attr)) return;
        if (attr && /^data-/.test(attr)) return;
        if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return;
        add(node.text);
      }
    } else if (ts.isTemplateExpression(node) && underJsx(node)) {
      add(node.head.text);
      for (const span of node.templateSpans) add(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...out];
}
