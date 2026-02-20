import ts from 'typescript';
import path from 'node:path';
import type { Parser } from './base-parser.js';
import type {
  ParseResult,
  ParseError,
  OIRNode,
  OIREdge,
  OIRNodeType,
  OIREdgeType,
} from '../oir/types.js';
import { generateOirId, hashNodeContent } from '../oir/hasher.js';

/**
 * TypeScript/JavaScript parser using the TypeScript Compiler API.
 *
 * Extracts:
 *   Nodes: module, function, class, component, route, variable, type_def, middleware
 *   Edges: imports, exports, calls, extends, implements, renders
 */
export class TypeScriptParser implements Parser {
  readonly language = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  private source = '';
  private filePath = '';
  private sourceFile: ts.SourceFile | null = null;
  private nodes: OIRNode[] = [];
  private edges: OIREdge[] = [];
  private errors: ParseError[] = [];
  private moduleOirId = '';

  parse(source: string, filePath: string): ParseResult {
    this.source = source;
    this.filePath = filePath;
    this.nodes = [];
    this.edges = [];
    this.errors = [];

    // Determine script kind based on extension
    const ext = path.extname(filePath);
    let scriptKind = ts.ScriptKind.TS;
    if (ext === '.tsx' || ext === '.jsx') scriptKind = ts.ScriptKind.TSX;
    else if (ext === '.js' || ext === '.mjs' || ext === '.cjs')
      scriptKind = ts.ScriptKind.JS;

    try {
      this.sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        scriptKind,
      );
    } catch (e) {
      this.errors.push({
        file_path: filePath,
        line: null,
        message: `Failed to parse: ${e instanceof Error ? e.message : String(e)}`,
      });
      return { nodes: [], edges: [], errors: this.errors };
    }

    // Create module node for this file
    this.moduleOirId = generateOirId(filePath, path.basename(filePath), 'module', 1);
    this.nodes.push({
      oir_id: this.moduleOirId,
      type: 'module',
      name: path.basename(filePath, ext),
      file_path: filePath,
      line_start: 1,
      line_end: this.sourceFile.getLineAndCharacterOfPosition(source.length).line + 1,
      signature: null,
      doc_comment: null,
      metadata: { extension: ext },
      content_hash: '', // Will be set by the index command using file-level hash
    });

    // Walk the AST
    this.visitNode(this.sourceFile);

    return {
      nodes: this.nodes,
      edges: this.edges,
      errors: this.errors,
    };
  }

  private visitNode(node: ts.Node): void {
    // ── Import declarations ──
    if (ts.isImportDeclaration(node)) {
      this.extractImport(node);
    }

    // ── Export declarations ──
    if (ts.isExportDeclaration(node)) {
      this.extractExportDeclaration(node);
    }

    // ── Function declarations (including exported) ──
    if (ts.isFunctionDeclaration(node) && node.name) {
      this.extractFunction(node);
    }

    // ── Arrow function / const function ──
    if (ts.isVariableStatement(node)) {
      this.extractVariableStatement(node);
    }

    // ── Class declarations ──
    if (ts.isClassDeclaration(node) && node.name) {
      this.extractClass(node);
    }

    // ── Interface / type alias ──
    if (ts.isInterfaceDeclaration(node)) {
      this.extractTypeDef(node);
    }
    if (ts.isTypeAliasDeclaration(node)) {
      this.extractTypeDef(node);
    }

    // ── Enum declarations ──
    if (ts.isEnumDeclaration(node)) {
      this.extractTypeDef(node);
    }

    // Recurse into children (but not into function/class bodies for top-level scan)
    ts.forEachChild(node, (child) => this.visitNode(child));
  }

  // ─── Import Extraction ───

  private extractImport(node: ts.ImportDeclaration): void {
    const moduleSpec = node.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpec)) return;

    const importPath = moduleSpec.text;
    let targetOirId: string;

    if (importPath.startsWith('.')) {
      // Relative import → resolve to file path (target will be resolved by OIRBuilder)
      const resolvedPath = this.resolveRelativeImport(importPath);
      targetOirId = resolvedPath;
    } else {
      // External package import → create or reference external_api node
      const extName = importPath.split('/')[0] ?? importPath;
      targetOirId = generateOirId(
        `external:${extName}`,
        extName,
        'external_api',
        0,
      );

      // Add external_api node if not already added (deduplicated later)
      this.nodes.push({
        oir_id: targetOirId,
        type: 'external_api',
        name: extName,
        file_path: `external:${extName}`,
        line_start: null,
        line_end: null,
        signature: null,
        doc_comment: null,
        metadata: { package: importPath },
        content_hash: '',
      });
    }

    this.edges.push({
      source_oir_id: this.moduleOirId,
      target_oir_id: targetOirId,
      type: 'imports',
      metadata: { import_path: importPath },
    });
  }

  private resolveRelativeImport(importPath: string): string {
    const dir = path.dirname(this.filePath);
    let resolved = path.join(dir, importPath);

    // Normalize path separators
    resolved = resolved.replace(/\\/g, '/');

    // Try common extensions if none specified
    const ext = path.extname(resolved);
    if (!ext) {
      // Return the base path as-is — OIRBuilder.resolveEdges() will
      // match it against module nodes by file_path.
    }

    return resolved;
  }

  // ─── Function Extraction ───

  private extractFunction(node: ts.FunctionDeclaration): void {
    const name = node.name!.text;
    const sf = this.sourceFile!;
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

    const isExported = this.hasExportModifier(node);
    const isComponent = this.isReactComponent(name, node);
    const nodeType: OIRNodeType = isComponent ? 'component' : 'function';

    const oirId = generateOirId(this.filePath, name, nodeType, startLine);
    const signature = this.getFunctionSignature(node);
    const docComment = this.getJsDocComment(node);

    this.nodes.push({
      oir_id: oirId,
      type: nodeType,
      name,
      file_path: this.filePath,
      line_start: startLine,
      line_end: endLine,
      signature,
      doc_comment: docComment,
      metadata: {
        is_async: !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
        is_exported: isExported,
        params: node.parameters.map((p) => p.name.getText(sf)),
      },
      content_hash: hashNodeContent(this.source, startLine, endLine),
    });

    // Export edge
    if (isExported) {
      this.edges.push({
        source_oir_id: this.moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Extract calls within this function
    if (node.body) {
      this.extractCalls(node.body, oirId);
    }

    // Extract JSX renders from component body
    if (isComponent && node.body) {
      this.extractJsxRenders(node.body, oirId);
    }
  }

  // ─── Variable Statement (const arrow functions, variables) ───

  private extractVariableStatement(node: ts.VariableStatement): void {
    const sf = this.sourceFile!;
    const isExported = this.hasExportModifier(node);

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;

      if (!decl.initializer) continue;

      const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

      // Arrow function or function expression
      if (
        ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer)
      ) {
        const fn = decl.initializer;
        const isComponent = this.isReactComponent(name, fn);
        const nodeType: OIRNodeType = isComponent ? 'component' : 'function';
        const oirId = generateOirId(this.filePath, name, nodeType, startLine);

        const paramNames = fn.parameters.map((p) => p.name.getText(sf));
        const signature = `const ${name} = (${paramNames.join(', ')}) => ...`;
        const docComment = this.getJsDocComment(node);

        this.nodes.push({
          oir_id: oirId,
          type: nodeType,
          name,
          file_path: this.filePath,
          line_start: startLine,
          line_end: endLine,
          signature,
          doc_comment: docComment,
          metadata: {
            is_async: !!fn.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
            ),
            is_exported: isExported,
            is_arrow: ts.isArrowFunction(fn),
            params: paramNames,
          },
          content_hash: hashNodeContent(this.source, startLine, endLine),
        });

        if (isExported) {
          this.edges.push({
            source_oir_id: this.moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }

        if (fn.body) {
          this.extractCalls(fn.body, oirId);
          if (isComponent) {
            this.extractJsxRenders(fn.body, oirId);
          }
        }
      } else if (this.isTopLevel(node)) {
        // Top-level variable (non-function)
        const oirId = generateOirId(this.filePath, name, 'variable', startLine);
        this.nodes.push({
          oir_id: oirId,
          type: 'variable',
          name,
          file_path: this.filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `const ${name}`,
          doc_comment: this.getJsDocComment(node),
          metadata: { is_exported: isExported },
          content_hash: hashNodeContent(this.source, startLine, endLine),
        });

        if (isExported) {
          this.edges.push({
            source_oir_id: this.moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }
      }
    }
  }

  // ─── Class Extraction ───

  private extractClass(node: ts.ClassDeclaration): void {
    const name = node.name!.text;
    const sf = this.sourceFile!;
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const isExported = this.hasExportModifier(node);

    const oirId = generateOirId(this.filePath, name, 'class', startLine);
    const docComment = this.getJsDocComment(node);

    this.nodes.push({
      oir_id: oirId,
      type: 'class',
      name,
      file_path: this.filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `class ${name}`,
      doc_comment: docComment,
      metadata: {
        is_exported: isExported,
        member_count: node.members.length,
      },
      content_hash: hashNodeContent(this.source, startLine, endLine),
    });

    if (isExported) {
      this.edges.push({
        source_oir_id: this.moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Heritage clauses (extends, implements)
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        const edgeType: OIREdgeType =
          clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
        for (const type of clause.types) {
          const targetName = type.expression.getText(sf);
          // Create a placeholder edge — resolved later by name matching
          const targetOirId = generateOirId(
            this.filePath,
            targetName,
            'class',
            0, // unknown line — will be resolved
          );
          this.edges.push({
            source_oir_id: oirId,
            target_oir_id: targetOirId,
            type: edgeType,
            metadata: { target_name: targetName },
          });
        }
      }
    }

    // Extract method calls within class methods
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.body) {
        this.extractCalls(member.body, oirId);
      }
      if (ts.isConstructorDeclaration(member) && member.body) {
        this.extractCalls(member.body, oirId);
      }
    }
  }

  // ─── Type/Interface/Enum Extraction ───

  private extractTypeDef(
    node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration,
  ): void {
    const name = node.name.text;
    const sf = this.sourceFile!;
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const isExported = this.hasExportModifier(node);

    const kind = ts.isInterfaceDeclaration(node)
      ? 'interface'
      : ts.isEnumDeclaration(node)
        ? 'enum'
        : 'type';

    const oirId = generateOirId(this.filePath, name, 'type_def', startLine);

    this.nodes.push({
      oir_id: oirId,
      type: 'type_def',
      name,
      file_path: this.filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `${kind} ${name}`,
      doc_comment: this.getJsDocComment(node),
      metadata: { kind, is_exported: isExported },
      content_hash: hashNodeContent(this.source, startLine, endLine),
    });

    if (isExported) {
      this.edges.push({
        source_oir_id: this.moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }
  }

  // ─── Export Declaration ───

  private extractExportDeclaration(node: ts.ExportDeclaration): void {
    // Re-exports: export { x } from './y'
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const importPath = node.moduleSpecifier.text;
      let targetOirId: string;

      if (importPath.startsWith('.')) {
        targetOirId = this.resolveRelativeImport(importPath);
      } else {
        const extName = importPath.split('/')[0] ?? importPath;
        targetOirId = generateOirId(
          `external:${extName}`,
          extName,
          'external_api',
          0,
        );
      }

      this.edges.push({
        source_oir_id: this.moduleOirId,
        target_oir_id: targetOirId,
        type: 'imports',
        metadata: { re_export: true, import_path: importPath },
      });
    }
  }

  // ─── Call Expression Extraction ───

  private extractCalls(body: ts.Node, callerOirId: string): void {
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const calleeName = this.getCallExpressionName(node);
        if (calleeName) {
          this.edges.push({
            source_oir_id: callerOirId,
            target_oir_id: generateOirId(this.filePath, calleeName, 'function', 0),
            type: 'calls',
            metadata: { callee: calleeName },
          });
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
  }

  // ─── JSX Render Extraction ───

  private extractJsxRenders(body: ts.Node, componentOirId: string): void {
    const walk = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(this.sourceFile!);
        // Only track PascalCase tags (React components, not HTML elements)
        if (/^[A-Z]/.test(tagName)) {
          this.edges.push({
            source_oir_id: componentOirId,
            target_oir_id: generateOirId(this.filePath, tagName, 'component', 0),
            type: 'renders',
            metadata: { component: tagName },
          });
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(body, walk);
  }

  // ─── Helper Methods ───

  private getCallExpressionName(node: ts.CallExpression): string | null {
    const expr = node.expression;

    // Simple identifier: foo()
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }

    // Property access: obj.method()
    if (ts.isPropertyAccessExpression(expr)) {
      return expr.name.text;
    }

    return null;
  }

  private hasExportModifier(node: ts.Node): boolean {
    if (!ts.canHaveModifiers(node)) return false;
    const modifiers = ts.getModifiers(node);
    return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }

  private isReactComponent(
    name: string,
    node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  ): boolean {
    // PascalCase name is the primary heuristic
    if (!/^[A-Z]/.test(name)) return false;

    // Check if the function returns JSX (by scanning the body text)
    const sf = this.sourceFile!;
    const bodyText = node.body?.getText(sf) ?? '';
    if (bodyText.includes('<') && bodyText.includes('/>')) return true;
    if (bodyText.includes('React.createElement')) return true;
    if (bodyText.includes('jsx(') || bodyText.includes('jsxs(')) return true;

    // Check parameter types for React.FC pattern
    if (node.parameters.length > 0) {
      const firstParam = node.parameters[0]!;
      const paramText = firstParam.getText(sf);
      if (paramText.includes('Props') || paramText.includes('props')) return true;
    }

    return false;
  }

  private isTopLevel(node: ts.Node): boolean {
    return node.parent?.kind === ts.SyntaxKind.SourceFile;
  }

  private getFunctionSignature(node: ts.FunctionDeclaration): string {
    const sf = this.sourceFile!;
    const name = node.name?.text ?? 'anonymous';
    const params = node.parameters.map((p) => p.getText(sf)).join(', ');
    const returnType = node.type ? `: ${node.type.getText(sf)}` : '';
    const asyncPrefix = node.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
    )
      ? 'async '
      : '';
    return `${asyncPrefix}function ${name}(${params})${returnType}`;
  }

  private getJsDocComment(node: ts.Node): string | null {
    const sf = this.sourceFile!;
    const fullText = sf.getFullText();
    const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());

    if (!ranges?.length) return null;

    // Find the last JSDoc comment (/** ... */)
    for (let i = ranges.length - 1; i >= 0; i--) {
      const range = ranges[i]!;
      const text = fullText.slice(range.pos, range.end);
      if (text.startsWith('/**')) {
        // Clean up JSDoc markers
        return text
          .replace(/^\/\*\*\s*/, '')
          .replace(/\s*\*\/$/, '')
          .replace(/^\s*\* ?/gm, '')
          .trim();
      }
    }

    return null;
  }
}
