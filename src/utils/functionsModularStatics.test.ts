// src/utils/functionsModularStatics.test.ts
//
// The functions reach Firestore's statics (FieldValue, Timestamp, FieldPath, …) through the modular entry,
// `import { FieldValue } from "firebase-admin/firestore"`, never through the namespace
// `admin.firestore.FieldValue`. Same objects in production; under the FUNCTIONS EMULATOR the namespace
// has no statics, so every write that stamps a time failed there (measured 05.10.2026: onMessageCreated
// left no preview and no bell row, "Cannot read properties of undefined (reading 'serverTimestamp')").
// `admin.firestore()` stays, and `admin.firestore.X` as a TYPE is fine: types do not exist at run time.
// Read with the TypeScript parser, so a comment that names the trap does not count. The emulator strips
// the statics because it wraps firebase-admin's main entry and binds its function-valued properties
// (firebase-tools functionsEmulatorRuntime, `Proxied`); the `firebase-admin/firestore` subpath is not wrapped.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd(), 'functions', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []);
}

const isAdminModule = (e: ts.Node | undefined) => !!e && ts.isStringLiteral(e) && e.text === 'firebase-admin';

/** Only a type: erased at run time, so the emulator never sees it. A class `extends` is a value. */
function typeOnly(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isExpressionWithTypeArguments(p)) {
      const clause = p.parent;
      return ts.isHeritageClause(clause)
        && (clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent));
    }
    if (ts.isTypeNode(p)) return true;
    if (ts.isStatement(p)) return false;
  }
  return false;
}

/**
 * Every value-position use of firebase-admin's `firestore` namespace that is not the call
 * `admin.firestore()`: `admin.firestore.X`, `admin["firestore"]`, `const { X } = admin.firestore`, and
 * the same through `import { firestore } from "firebase-admin"`.
 */
function namespaceStaticsOf(sf: ts.SourceFile): string[] {
  const admins = new Set<string>();      // bindings of the whole module: admin.firestore
  const firestores = new Set<string>();  // bindings of its `firestore` itself
  const visitDecl = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && isAdminModule(n.moduleSpecifier)) {
      const c = n.importClause;
      if (c?.name) admins.add(c.name.text);
      const b = c?.namedBindings;
      if (b && ts.isNamespaceImport(b)) admins.add(b.name.text);
      if (b && ts.isNamedImports(b)) {
        for (const s of b.elements) if ((s.propertyName ?? s.name).text === 'firestore') firestores.add(s.name.text);
      }
    }
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)
        && isAdminModule(n.moduleReference.expression)) admins.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer)
        && n.initializer.expression.getText(sf) === 'require' && isAdminModule(n.initializer.arguments[0])) admins.add(n.name.text);
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);

  const out: string[] = [];
  const report = (n: ts.Node) => {
    const called = ts.isCallExpression(n.parent) && n.parent.expression === n;
    if (called || typeOnly(n)) return;
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    out.push(`${relative(ROOT, sf.fileName)}:${line} ${n.parent.getText(sf).slice(0, 60)}`);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'firestore'
        && ts.isIdentifier(n.expression) && admins.has(n.expression.text)) report(n);
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && admins.has(n.expression.text)
        && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === 'firestore') report(n);
    // A `firestore` imported by name: every use of it, except the import itself, its calls and types.
    if (ts.isIdentifier(n) && firestores.has(n.text) && !ts.isImportSpecifier(n.parent)
        && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) report(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const namespaceStatics = (file: string) =>
  namespaceStaticsOf(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true));

describe('functions: Firestore statics come from firebase-admin/firestore', () => {
  const files = tsFiles(ROOT);

  it('reads the whole functions source', () => {
    // A wrong root would pass the check below on no files at all.
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith(join('src', 'index.ts')))).toBe(true);
  });

  it('no admin.firestore.FieldValue / Timestamp / FieldPath (or any other static) as a value', () => {
    expect(files.flatMap(namespaceStatics)).toEqual([]);
  });

  it('the check sees the forms it refuses, and lets through the ones it allows', () => {
    // The same walk, on in-memory files.
    const probe = (src: string) =>
      namespaceStaticsOf(ts.createSourceFile(join(ROOT, '__probe__.ts'), src, ts.ScriptTarget.Latest, true));
    const A = 'import * as admin from "firebase-admin";\n';
    // Refused: the namespace, however it is reached.
    expect(probe(`${A}const a = admin.firestore.FieldValue.serverTimestamp();`)).toHaveLength(1);
    expect(probe('import * as fb from "firebase-admin";\nconst { Timestamp } = fb.firestore;')).toHaveLength(1);
    expect(probe('import admin from "firebase-admin";\nconst q = admin.firestore.Filter;')).toHaveLength(1);
    expect(probe(`${A}const v = admin["firestore"].FieldValue;`)).toHaveLength(1);
    expect(probe('import { firestore } from "firebase-admin";\nconst a = firestore.FieldValue.serverTimestamp();')).toHaveLength(1);
    expect(probe('import { firestore as fs } from "firebase-admin";\nconst t = fs.Timestamp.now();')).toHaveLength(1);
    expect(probe('import admin = require("firebase-admin");\nconst d = admin.firestore.FieldValue.delete();')).toHaveLength(1);
    expect(probe('const admin = require("firebase-admin");\nconst p = admin.firestore.FieldPath.documentId();')).toHaveLength(1);
    expect(probe(`${A}class C extends admin.firestore.Timestamp {}`)).toHaveLength(1);
    // Allowed: the call, types, comments, the modular entry.
    expect(probe(`${A}const db = admin.firestore();\nlet t: admin.firestore.Transaction;\nlet f: typeof admin.firestore.FieldValue;`)).toEqual([]);
    expect(probe(`${A}interface G extends admin.firestore.DocumentData {}\nclass K implements admin.firestore.FirestoreDataConverter<G> {}`)).toEqual([]);
    expect(probe('import { firestore } from "firebase-admin";\nconst db = firestore();\nlet q: firestore.Query;')).toEqual([]);
    expect(probe(`${A}// admin.firestore.FieldValue is the trap\nconst x = 1;`)).toEqual([]);
    expect(probe('import { FieldValue } from "firebase-admin/firestore";\nconst a = FieldValue.serverTimestamp();')).toEqual([]);
  });
});
