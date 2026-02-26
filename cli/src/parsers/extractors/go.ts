/**
 * Go extractor — tree-sitter based.
 *
 * Extracts:
 *   Nodes: module (package), function, class (struct), type_def (interface/type), variable
 *   Edges: imports, exports, calls, extends (interface embedding), implements
 */
import type Parser from 'tree-sitter';
import path from 'node:path';
import type { Extractor } from '../base-extractor.js';
import type {
  ParseResult,
  ParseError,
  OIRNode,
  OIREdge,
} from '../../oir/types.js';
import { generateOirId, hashNodeContent } from '../../oir/hasher.js';

export class GoExtractor implements Extractor {
  readonly language = 'go' as const;

  extract(tree: Parser.Tree, source: string, filePath: string): ParseResult {
    const nodes: OIRNode[] = [];
    const edges: OIREdge[] = [];
    const errors: ParseError[] = [];

    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const lastLine = source.split('\n').length;

    // Module node
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
    });

    const root = tree.rootNode;

    // Get package name
    const pkgClause = root.namedChildren.find((c) => c.type === 'package_clause');
    if (pkgClause) {
      const pkgName = pkgClause.namedChildren.find((c) => c.type === 'package_identifier');
      if (pkgName) {
        nodes[0]!.metadata = { ...nodes[0]!.metadata, package: pkgName.text };
      }
    }

    for (const child of root.namedChildren) {
      try {
        switch (child.type) {
          case 'import_declaration':
            this.extractImports(child, moduleOirId, nodes, edges);
            break;

          case 'function_declaration':
            this.extractFunction(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'method_declaration':
            this.extractMethod(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'type_declaration':
            this.extractTypeDeclaration(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'var_declaration':
          case 'const_declaration':
            this.extractVarDeclaration(child, source, filePath, moduleOirId, nodes, edges);
            break;
        }
      } catch (err) {
        errors.push({
          file_path: filePath,
          line: child.startPosition.row + 1,
          message: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return { nodes, edges, errors };
  }

  // ─── Imports ───

  private extractImports(
    node: Parser.SyntaxNode,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    // import "fmt" or import ( "fmt"\n "os" )
    const specs = node.namedChildren.filter(
      (c) => c.type === 'import_spec' || c.type === 'import_spec_list',
    );

    const extractSpec = (spec: Parser.SyntaxNode): void => {
      if (spec.type === 'import_spec_list') {
        for (const inner of spec.namedChildren) {
          extractSpec(inner);
        }
        return;
      }

      const pathNode = spec.childForFieldName('path') ?? spec.namedChildren.find(
        (c) => c.type === 'interpreted_string_literal',
      );
      if (!pathNode) return;

      const importPath = pathNode.text.replace(/^"|"$/g, '');
      const pkgName = importPath.split('/').pop() ?? importPath;

      const targetOirId = generateOirId(`external:${pkgName}`, pkgName, 'external_api', 0);
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
      });

      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: targetOirId,
        type: 'imports',
        metadata: { import_path: importPath },
      });
    };

    for (const spec of specs) {
      extractSpec(spec);
    }
  }

  // ─── Function Declaration ───

  private extractFunction(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // In Go, exported = starts with uppercase
    const isExported = /^[A-Z]/.test(name);

    const oirId = generateOirId(filePath, name, 'function', startLine);
    const params = this.extractParams(node);
    const docComment = this.getDocComment(node);

    nodes.push({
      oir_id: oirId,
      type: 'function',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `func ${name}(${params.join(', ')})`,
      doc_comment: docComment,
      metadata: { is_exported: isExported, params },
      content_hash: hashNodeContent(source, startLine, endLine),
    });

    if (isExported) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Extract calls
    const body = node.childForFieldName('body');
    if (body) {
      this.extractCalls(body, oirId, edges);
    }
  }

  // ─── Method Declaration ───

  private extractMethod(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = /^[A-Z]/.test(name);

    // Get receiver type
    const receiver = node.childForFieldName('receiver');
    let receiverType = '';
    if (receiver) {
      const typeNode = receiver.namedChildren.find(
        (c) => c.type === 'parameter_declaration',
      );
      if (typeNode) {
        const rType = typeNode.childForFieldName('type');
        receiverType = rType?.text.replace(/^\*/, '') ?? '';
      }
    }

    const fullName = receiverType ? `${receiverType}.${name}` : name;
    const oirId = generateOirId(filePath, fullName, 'function', startLine);

    nodes.push({
      oir_id: oirId,
      type: 'function',
      name: fullName,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `func (${receiverType}) ${name}(...)`,
      doc_comment: this.getDocComment(node),
      metadata: { is_exported: isExported, receiver_type: receiverType, is_method: true },
      content_hash: hashNodeContent(source, startLine, endLine),
    });

    if (isExported) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    const body = node.childForFieldName('body');
    if (body) {
      this.extractCalls(body, oirId, edges);
    }
  }

  // ─── Type Declaration (struct, interface, type alias) ───

  private extractTypeDeclaration(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    // type_declaration can contain multiple type_spec children
    const specs = node.namedChildren.filter((c) => c.type === 'type_spec');

    for (const spec of specs) {
      const nameNode = spec.childForFieldName('name');
      const typeNode = spec.childForFieldName('type');
      if (!nameNode || !typeNode) continue;

      const name = nameNode.text;
      const startLine = spec.startPosition.row + 1;
      const endLine = spec.endPosition.row + 1;
      const isExported = /^[A-Z]/.test(name);

      if (typeNode.type === 'struct_type') {
        // Struct → class
        const oirId = generateOirId(filePath, name, 'class', startLine);
        const fieldList = typeNode.childForFieldName('body') ?? typeNode.namedChildren.find(
          (c) => c.type === 'field_declaration_list',
        );
        const fieldCount = fieldList?.namedChildren.filter(
          (c) => c.type === 'field_declaration',
        ).length ?? 0;

        nodes.push({
          oir_id: oirId,
          type: 'class',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `type ${name} struct`,
          doc_comment: this.getDocComment(spec.parent ?? spec),
          metadata: { kind: 'struct', is_exported: isExported, field_count: fieldCount },
          content_hash: hashNodeContent(source, startLine, endLine),
        });

        if (isExported) {
          edges.push({
            source_oir_id: moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }

        // Embedded struct fields → extends
        if (fieldList) {
          for (const field of fieldList.namedChildren) {
            if (field.type === 'field_declaration' && field.namedChildren.length === 1) {
              // An embedded field has only a type, no name
              const embeddedType = field.namedChildren[0];
              if (embeddedType && !field.childForFieldName('name')) {
                const embeddedName = embeddedType.text.replace(/^\*/, '');
                edges.push({
                  source_oir_id: oirId,
                  target_oir_id: `__unresolved__::${embeddedName}::class`,
                  type: 'extends',
                  metadata: { target_name: embeddedName, embedded: true },
                });
              }
            }
          }
        }
      } else if (typeNode.type === 'interface_type') {
        // Interface → type_def
        const oirId = generateOirId(filePath, name, 'type_def', startLine);

        nodes.push({
          oir_id: oirId,
          type: 'type_def',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `type ${name} interface`,
          doc_comment: this.getDocComment(spec.parent ?? spec),
          metadata: { kind: 'interface', is_exported: isExported },
          content_hash: hashNodeContent(source, startLine, endLine),
        });

        if (isExported) {
          edges.push({
            source_oir_id: moduleOirId,
            target_oir_id: oirId,
            type: 'exports',
            metadata: {},
          });
        }
      } else {
        // Type alias → type_def
        const oirId = generateOirId(filePath, name, 'type_def', startLine);

        nodes.push({
          oir_id: oirId,
          type: 'type_def',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `type ${name} ${typeNode.type}`,
          doc_comment: this.getDocComment(spec.parent ?? spec),
          metadata: { kind: 'alias', is_exported: isExported },
          content_hash: hashNodeContent(source, startLine, endLine),
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

  // ─── Variable/Const Declaration ───

  private extractVarDeclaration(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    const specs = node.namedChildren.filter(
      (c) => c.type === 'var_spec' || c.type === 'const_spec',
    );

    for (const spec of specs) {
      const nameNode = spec.childForFieldName('name') ?? spec.namedChildren.find(
        (c) => c.type === 'identifier',
      );
      if (!nameNode) continue;

      const name = nameNode.text;
      const startLine = spec.startPosition.row + 1;
      const endLine = spec.endPosition.row + 1;
      const isExported = /^[A-Z]/.test(name);
      const kind = node.type === 'const_declaration' ? 'const' : 'var';

      const oirId = generateOirId(filePath, name, 'variable', startLine);

      nodes.push({
        oir_id: oirId,
        type: 'variable',
        name,
        file_path: filePath,
        line_start: startLine,
        line_end: endLine,
        signature: `${kind} ${name}`,
        doc_comment: this.getDocComment(node),
        metadata: { kind, is_exported: isExported },
        content_hash: hashNodeContent(source, startLine, endLine),
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

  // ─── Call Extraction ───

  private extractCalls(
    body: Parser.SyntaxNode,
    callerOirId: string,
    edges: OIREdge[],
  ): void {
    const walk = (node: Parser.SyntaxNode): void => {
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        if (fn) {
          let calleeName: string | null = null;
          if (fn.type === 'identifier') {
            calleeName = fn.text;
          } else if (fn.type === 'selector_expression') {
            calleeName = fn.childForFieldName('field')?.text ?? null;
          }
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

  // ─── Helpers ───

  private extractParams(node: Parser.SyntaxNode): string[] {
    const params = node.childForFieldName('parameters');
    if (!params) return [];

    return params.namedChildren
      .filter((c) => c.type === 'parameter_declaration')
      .map((c) => {
        const nameNode = c.childForFieldName('name');
        return nameNode?.text ?? c.text;
      });
  }

  private getDocComment(node: Parser.SyntaxNode): string | null {
    // Go uses // line comments before declarations
    const comments: string[] = [];
    let sibling = node.previousSibling;

    while (sibling && sibling.type === 'comment') {
      comments.unshift(sibling.text.replace(/^\/\/\s?/, ''));
      sibling = sibling.previousSibling;
    }

    return comments.length > 0 ? comments.join('\n').trim() : null;
  }
}
