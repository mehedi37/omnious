/**
 * TypeScript / JavaScript extractor — tree-sitter based.
 *
 * Extracts:
 *   Nodes: module, function, class, component, variable, type_def, external_api
 *   Edges: imports, exports, calls, extends, implements, renders
 *
 * Ported from the original TS Compiler API parser to tree-sitter queries.
 */
import type Parser from 'tree-sitter';
import path from 'node:path';
import type { Extractor } from '../base-extractor.js';
import type {
  ParseResult,
  ParseError,
  OIRNode,
  OIREdge,
  OIRNodeType,
} from '../../oir/types.js';
import { generateOirId, hashNodeContent, extractCodeBody } from '../../oir/hasher.js';

export class TypeScriptExtractor implements Extractor {
  readonly language = 'typescript' as const;

  extract(tree: Parser.Tree, source: string, filePath: string): ParseResult {
    const nodes: OIRNode[] = [];
    const edges: OIREdge[] = [];
    const errors: ParseError[] = [];

    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);

    // Module node (always emitted per file)
    const lastLine = source.split('\n').length;
    const moduleOirId = generateOirId(filePath, baseName, 'module', 1);
    nodes.push({
      oir_id: moduleOirId,
      type: 'module',
      name: baseName,
      file_path: filePath,
      line_start: 1,
      line_end: lastLine,
      signature: null,
      doc_comment: null,
      metadata: { extension: ext },
      content_hash: '',
      code_body: null,
    });

    const root = tree.rootNode;

    // Walk top-level children
    for (const child of root.children) {
      try {
        switch (child.type) {
          case 'import_statement':
            this.extractImport(child, filePath, moduleOirId, nodes, edges);
            break;

          case 'export_statement':
            this.extractExport(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'function_declaration':
            this.extractFunction(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'lexical_declaration':
          case 'variable_declaration':
            this.extractVariableDeclaration(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'class_declaration':
            this.extractClass(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'interface_declaration':
          case 'type_alias_declaration':
          case 'enum_declaration':
            this.extractTypeDef(child, source, filePath, moduleOirId, nodes, edges);
            break;

          // Exported variations
          case 'export_declaration': {
            // e.g. `export function foo() {}` — the child is the actual declaration
            const decl = child.namedChildren[0];
            if (decl) {
              this.extractFromExported(decl, source, filePath, moduleOirId, nodes, edges);
            }
            break;
          }
        }
      } catch (err) {
        errors.push({
          file_path: filePath,
          line: child.startPosition.row + 1,
          message: `Extraction error in ${child.type}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return { nodes, edges, errors };
  }

  // ─── Import Extraction ───

  private extractImport(
    node: Parser.SyntaxNode,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;

    // Strip quotes from the string literal
    const importPath = sourceNode.text.replace(/^['"]|['"]$/g, '');
    let targetOirId: string;

    if (importPath.startsWith('.')) {
      // Relative import → resolve to file path (OIRBuilder resolves later)
      const dir = path.dirname(filePath);
      targetOirId = path.join(dir, importPath).replace(/\\/g, '/');
    } else {
      // External package
      const pkgName = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0] ?? importPath;

      targetOirId = generateOirId(`external:${pkgName}`, pkgName, 'external_api', 0);

      nodes.push({
        oir_id: targetOirId,
        type: 'external_api',
        name: pkgName,
        file_path: `external:${pkgName}`,
        line_start: null,
        line_end: null,
        signature: null,
        doc_comment: null,
        metadata: { package: importPath },
        content_hash: '',
        code_body: null,
      });
    }

    edges.push({
      source_oir_id: moduleOirId,
      target_oir_id: targetOirId,
      type: 'imports',
      metadata: { import_path: importPath },
    });
  }

  // ─── Export Statement (re-exports) ───

  private extractExport(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    // Check if this is export { x } from './y' (re-export)
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      const importPath = sourceNode.text.replace(/^['"]|['"]$/g, '');
      let targetOirId: string;
      if (importPath.startsWith('.')) {
        const dir = path.dirname(filePath);
        targetOirId = path.join(dir, importPath).replace(/\\/g, '/');
      } else {
        const pkgName = importPath.startsWith('@')
          ? importPath.split('/').slice(0, 2).join('/')
          : importPath.split('/')[0] ?? importPath;
        targetOirId = generateOirId(`external:${pkgName}`, pkgName, 'external_api', 0);
      }
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: targetOirId,
        type: 'imports',
        metadata: { re_export: true, import_path: importPath },
      });
      return;
    }

    // Export with declaration: `export function/class/const ...`
    const declaration = node.childForFieldName('declaration');
    if (declaration) {
      this.extractFromExported(declaration, source, filePath, moduleOirId, nodes, edges);
      return;
    }

    // Export default expression: `export default foo`
    const value = node.childForFieldName('value');
    if (value) {
      // Could be a function/class expression — extract if so
      if (value.type === 'function' || value.type === 'arrow_function') {
        const name = 'default';
        const startLine = value.startPosition.row + 1;
        const endLine = value.endPosition.row + 1;
        const oirId = generateOirId(filePath, name, 'function', startLine);
        nodes.push({
          oir_id: oirId,
          type: 'function',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `export default function`,
          doc_comment: null,
          metadata: { is_exported: true, is_default: true },
          content_hash: hashNodeContent(source, startLine, endLine),
          code_body: extractCodeBody(source, startLine, endLine),
        });
        edges.push({
          source_oir_id: moduleOirId,
          target_oir_id: oirId,
          type: 'exports',
          metadata: { is_default: true },
        });
      }
    }
  }

  // ─── Exported Declaration Handler ───

  private extractFromExported(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    switch (node.type) {
      case 'function_declaration':
        this.extractFunction(node, source, filePath, moduleOirId, nodes, edges, true);
        break;
      case 'lexical_declaration':
      case 'variable_declaration':
        this.extractVariableDeclaration(node, source, filePath, moduleOirId, nodes, edges, true);
        break;
      case 'class_declaration':
        this.extractClass(node, source, filePath, moduleOirId, nodes, edges, true);
        break;
      case 'interface_declaration':
      case 'type_alias_declaration':
      case 'enum_declaration':
        this.extractTypeDef(node, source, filePath, moduleOirId, nodes, edges, true);
        break;
    }
  }

  // ─── Function Extraction ───

  private extractFunction(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    isExported = false,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const isComponent = this.isReactComponent(name, node);
    const nodeType: OIRNodeType = isComponent ? 'component' : 'function';

    const oirId = generateOirId(filePath, name, nodeType, startLine);
    const docComment = this.getDocComment(node);
    const params = this.extractParams(node);
    const isAsync = node.children.some((c) => c.type === 'async');

    const signature = `${isAsync ? 'async ' : ''}function ${name}(${params.join(', ')})`;

    nodes.push({
      oir_id: oirId,
      type: nodeType,
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature,
      doc_comment: docComment,
      metadata: { is_async: isAsync, is_exported: isExported, params },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isExported) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Extract calls within function body
    const body = node.childForFieldName('body');
    if (body) {
      this.extractCalls(body, oirId, filePath, edges);
      if (isComponent) {
        this.extractJsxRenders(body, oirId, filePath, edges);
      }
    }
  }

  // ─── Variable Declaration (const arrow functions, variables) ───

  private extractVariableDeclaration(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    isExported = false,
  ): void {
    // A lexical/variable declaration may have multiple declarators
    const declarators = node.namedChildren.filter(
      (c) => c.type === 'variable_declarator',
    );

    for (const decl of declarators) {
      const nameNode = decl.childForFieldName('name');
      const valueNode = decl.childForFieldName('value');
      if (!nameNode || !valueNode) continue;

      const name = nameNode.text;
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;

      if (
        valueNode.type === 'arrow_function' ||
        valueNode.type === 'function' ||
        valueNode.type === 'function_expression'
      ) {
        const isComponent = this.isReactComponent(name, valueNode);
        const nodeType: OIRNodeType = isComponent ? 'component' : 'function';
        const oirId = generateOirId(filePath, name, nodeType, startLine);

        const params = this.extractParams(valueNode);
        const isAsync = valueNode.children.some((c) => c.type === 'async');
        const signature = `const ${name} = ${isAsync ? 'async ' : ''}(${params.join(', ')}) => ...`;

        nodes.push({
          oir_id: oirId,
          type: nodeType,
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature,
          doc_comment: this.getDocComment(node),
          metadata: {
            is_async: isAsync,
            is_exported: isExported,
            is_arrow: valueNode.type === 'arrow_function',
            params,
          },
          content_hash: hashNodeContent(source, startLine, endLine),
          code_body: extractCodeBody(source, startLine, endLine),
        });

        if (isExported) {
          edges.push({
            source_oir_id: moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }

        const body = valueNode.childForFieldName('body');
        if (body) {
          this.extractCalls(body, oirId, filePath, edges);
          if (isComponent) {
            this.extractJsxRenders(body, oirId, filePath, edges);
          }
        }
      } else {
        // Non-function variable
        const oirId = generateOirId(filePath, name, 'variable', startLine);
        nodes.push({
          oir_id: oirId,
          type: 'variable',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `const ${name}`,
          doc_comment: this.getDocComment(node),
          metadata: { is_exported: isExported },
          content_hash: hashNodeContent(source, startLine, endLine),
          code_body: extractCodeBody(source, startLine, endLine),
        });

        if (isExported) {
          edges.push({
            source_oir_id: moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }
      }
    }
  }

  // ─── Class Extraction ───

  private extractClass(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    isExported = false,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const oirId = generateOirId(filePath, name, 'class', startLine);

    const body = node.childForFieldName('body');
    const memberCount = body?.namedChildren.length ?? 0;

    nodes.push({
      oir_id: oirId,
      type: 'class',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `class ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { is_exported: isExported, member_count: memberCount },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isExported) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Heritage: extends / implements
    // tree-sitter-typescript represents these as `class_heritage` children
    for (const child of node.namedChildren) {
      if (child.type === 'extends_clause') {
        const base = child.namedChildren[0];
        if (base) {
          edges.push({
            source_oir_id: oirId,
            target_oir_id: `__unresolved__::${base.text}::class`,
            type: 'extends',
            metadata: { target_name: base.text },
          });
        }
      }
      if (child.type === 'implements_clause') {
        for (const iface of child.namedChildren) {
          // iface might be a generic_type or plain identifier
          const ifaceName = iface.type === 'generic_type'
            ? (iface.childForFieldName('name')?.text ?? iface.text)
            : iface.text;
          edges.push({
            source_oir_id: oirId,
            target_oir_id: `__unresolved__::${ifaceName}::class`,
            type: 'implements',
            metadata: { target_name: ifaceName },
          });
        }
      }
    }

    // Extract method calls
    if (body) {
      for (const member of body.namedChildren) {
        if (
          member.type === 'method_definition' ||
          member.type === 'public_field_definition'
        ) {
          const methodBody = member.childForFieldName('body');
          if (methodBody) {
            this.extractCalls(methodBody, oirId, filePath, edges);
          }
        }
      }
    }
  }

  // ─── Type/Interface/Enum Extraction ───

  private extractTypeDef(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    isExported = false,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const kind = node.type === 'interface_declaration'
      ? 'interface'
      : node.type === 'enum_declaration'
        ? 'enum'
        : 'type';

    const oirId = generateOirId(filePath, name, 'type_def', startLine);

    nodes.push({
      oir_id: oirId,
      type: 'type_def',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `${kind} ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { kind, is_exported: isExported },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isExported) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }
  }

  // ─── Call Extraction (recursive walk) ───

  private extractCalls(
    body: Parser.SyntaxNode,
    callerOirId: string,
    _filePath: string,
    edges: OIREdge[],
  ): void {
    const walk = (node: Parser.SyntaxNode): void => {
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (fn) {
          const calleeName = this.getCalleeName(fn);
          if (calleeName) {
            edges.push({
              source_oir_id: callerOirId,
              target_oir_id: `__unresolved__::${calleeName}::function`,
              type: 'calls',
              metadata: { callee: calleeName },
            });
          }
        }
      }
      for (const child of node.namedChildren) {
        walk(child);
      }
    };

    for (const child of body.namedChildren) {
      walk(child);
    }
  }

  // ─── JSX Render Extraction ───

  private extractJsxRenders(
    body: Parser.SyntaxNode,
    componentOirId: string,
    _filePath: string,
    edges: OIREdge[],
  ): void {
    const walk = (node: Parser.SyntaxNode): void => {
      if (
        node.type === 'jsx_opening_element' ||
        node.type === 'jsx_self_closing_element'
      ) {
        const nameNode = node.childForFieldName('name');
        if (nameNode && /^[A-Z]/.test(nameNode.text)) {
          edges.push({
            source_oir_id: componentOirId,
            target_oir_id: `__unresolved__::${nameNode.text}::component`,
            type: 'renders',
            metadata: { component: nameNode.text },
          });
        }
      }
      for (const child of node.namedChildren) {
        walk(child);
      }
    };

    for (const child of body.namedChildren) {
      walk(child);
    }
  }

  // ─── Helper Methods ───

  private getCalleeName(fn: Parser.SyntaxNode): string | null {
    // Simple identifier: foo()
    if (fn.type === 'identifier') return fn.text;

    // Property access: obj.method()
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property');
      return prop?.text ?? null;
    }

    return null;
  }

  private isReactComponent(name: string, node: Parser.SyntaxNode): boolean {
    if (!/^[A-Z]/.test(name)) return false;

    const text = node.text;
    // Check for JSX markers
    if (text.includes('<') && (text.includes('/>') || text.includes('</'))) return true;
    if (text.includes('React.createElement')) return true;
    if (text.includes('jsx(') || text.includes('jsxs(')) return true;

    // Check if first parameter has "Props" or "props" in its name/type
    const params = node.childForFieldName('parameters') ?? node.childForFieldName('parameter');
    if (params) {
      const firstParam = params.namedChildren[0];
      if (firstParam && (firstParam.text.includes('Props') || firstParam.text.includes('props'))) {
        return true;
      }
    }

    return false;
  }

  private extractParams(node: Parser.SyntaxNode): string[] {
    const params = node.childForFieldName('parameters');
    if (!params) return [];

    return params.namedChildren
      .filter((c) =>
        c.type === 'required_parameter' ||
        c.type === 'optional_parameter' ||
        c.type === 'identifier' ||
        c.type === 'rest_parameter' ||
        c.type === 'formal_parameters',
      )
      .map((c) => {
        const nameNode = c.childForFieldName('pattern') ?? c.childForFieldName('name');
        return nameNode?.text ?? c.text;
      });
  }

  private getDocComment(node: Parser.SyntaxNode): string | null {
    // Look for a comment node immediately preceding this node
    const prev = node.previousNamedSibling;
    if (prev?.type === 'comment' && prev.text.startsWith('/**')) {
      return prev.text
        .replace(/^\/\*\*\s*/, '')
        .replace(/\s*\*\/$/, '')
        .replace(/^\s*\* ?/gm, '')
        .trim();
    }

    // Also check anonymous children (some grammars attach comments differently)
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'comment' && sibling.text.startsWith('/**')) {
        return sibling.text
          .replace(/^\/\*\*\s*/, '')
          .replace(/\s*\*\/$/, '')
          .replace(/^\s*\* ?/gm, '')
          .trim();
      }
      // Stop if we hit a non-comment, non-whitespace node
      if (sibling.type !== 'comment') break;
      sibling = sibling.previousSibling;
    }

    return null;
  }
}
