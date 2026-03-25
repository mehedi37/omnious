/**
 * C# extractor — tree-sitter based.
 *
 * Extracts:
 *   Nodes: module (file), class, function (method), type_def (interface/enum/struct), variable
 *   Edges: imports (using), exports, calls, extends, implements
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
import { generateOirId, hashNodeContent, extractCodeBody } from '../../oir/hasher.js';

export class CSharpExtractor implements Extractor {
  readonly language = 'csharp' as const;

  extract(tree: Parser.Tree, source: string, filePath: string): ParseResult {
    const nodes: OIRNode[] = [];
    const edges: OIREdge[] = [];
    const errors: ParseError[] = [];

    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const lastLine = source.split('\n').length;

    // Module node
    const moduleOirId = generateOirId(filePath, baseName, 'module', '');
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

    this.walkCompilationUnit(tree.rootNode, source, filePath, moduleOirId, nodes, edges, errors);

    return { nodes, edges, errors };
  }

  private walkCompilationUnit(
    root: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    errors: ParseError[],
  ): void {
    for (const child of root.namedChildren) {
      try {
        switch (child.type) {
          case 'using_directive':
            this.extractUsing(child, moduleOirId, nodes, edges);
            break;

          case 'namespace_declaration':
          case 'file_scoped_namespace_declaration':
            this.extractNamespace(child, source, filePath, moduleOirId, nodes, edges, errors);
            break;

          case 'class_declaration':
          case 'record_declaration':
            this.extractClass(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'interface_declaration':
            this.extractInterface(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'enum_declaration':
            this.extractEnum(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'struct_declaration':
            this.extractStruct(child, source, filePath, moduleOirId, nodes, edges);
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
  }

  // ─── Using Directive ───

  private extractUsing(
    node: Parser.SyntaxNode,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    // using System.Collections.Generic;
    const nameNode = node.namedChildren.find(
      (c) => c.type === 'qualified_name' || c.type === 'identifier' || c.type === 'name',
    );
    if (!nameNode) return;

    const usingPath = nameNode.text;
    const topLevel = usingPath.split('.')[0] ?? usingPath;

    const targetOirId = generateOirId(`external:${topLevel}`, topLevel, 'external_api', '');
    nodes.push({
      oir_id: targetOirId,
      type: 'external_api',
      name: topLevel,
      file_path: `external:${topLevel}`,
      line_start: null,
      line_end: null,
      signature: null,
      doc_comment: null,
      metadata: { namespace: usingPath },
      content_hash: '',
      code_body: null,
    });

    edges.push({
      source_oir_id: moduleOirId,
      target_oir_id: targetOirId,
      type: 'imports',
      metadata: { import_path: usingPath },
    });
  }

  // ─── Namespace ───

  private extractNamespace(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    errors: ParseError[],
  ): void {
    // Walk namespace body for class/interface/enum declarations
    const body = node.childForFieldName('body') ?? node;

    for (const child of body.namedChildren) {
      if (child.type === 'declaration_list') {
        // Namespace has a declaration_list body
        for (const decl of child.namedChildren) {
          try {
            this.extractDeclaration(decl, source, filePath, moduleOirId, nodes, edges, errors);
          } catch (err) {
            errors.push({
              file_path: filePath,
              line: decl.startPosition.row + 1,
              message: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      } else {
        // File-scoped namespace — declarations are direct children
        try {
          this.extractDeclaration(child, source, filePath, moduleOirId, nodes, edges, errors);
        } catch (err) {
          errors.push({
            file_path: filePath,
            line: child.startPosition.row + 1,
            message: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }

  private extractDeclaration(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    _errors: ParseError[],
  ): void {
    switch (node.type) {
      case 'class_declaration':
      case 'record_declaration':
        this.extractClass(node, source, filePath, moduleOirId, nodes, edges);
        break;
      case 'interface_declaration':
        this.extractInterface(node, source, filePath, moduleOirId, nodes, edges);
        break;
      case 'enum_declaration':
        this.extractEnum(node, source, filePath, moduleOirId, nodes, edges);
        break;
      case 'struct_declaration':
        this.extractStruct(node, source, filePath, moduleOirId, nodes, edges);
        break;
    }
  }

  // ─── Class ───

  private extractClass(
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
    const isPublic = this.hasModifier(node, 'public');
    const isRecord = node.type === 'record_declaration';

    const oirId = generateOirId(filePath, name, 'class', `${isRecord ? 'record' : 'class'} ${name}`);

    nodes.push({
      oir_id: oirId,
      type: 'class',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `${isRecord ? 'record' : 'class'} ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { kind: isRecord ? 'record' : 'class', is_exported: isPublic },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Base list: extends + implements
    const baseList = node.childForFieldName('bases') ?? node.namedChildren.find(
      (c) => c.type === 'base_list',
    );
    if (baseList) {
      this.extractBaseList(baseList, oirId, edges);
    }

    // Body: methods
    const body = node.childForFieldName('body') ?? node.namedChildren.find(
      (c) => c.type === 'declaration_list',
    );
    if (body) {
      this.extractClassBody(body, source, filePath, oirId, nodes, edges);
    }
  }

  // ─── Interface ───

  private extractInterface(
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
    const isPublic = this.hasModifier(node, 'public');

    const oirId = generateOirId(filePath, name, 'type_def', `interface ${name}`);

    nodes.push({
      oir_id: oirId,
      type: 'type_def',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `interface ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { kind: 'interface', is_exported: isPublic },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }
  }

  // ─── Enum ───

  private extractEnum(
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
    const isPublic = this.hasModifier(node, 'public');

    const oirId = generateOirId(filePath, name, 'type_def', `enum ${name}`);

    nodes.push({
      oir_id: oirId,
      type: 'type_def',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `enum ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { kind: 'enum', is_exported: isPublic },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }
  }

  // ─── Struct ───

  private extractStruct(
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
    const isPublic = this.hasModifier(node, 'public');

    const oirId = generateOirId(filePath, name, 'class', `struct ${name}`);

    nodes.push({
      oir_id: oirId,
      type: 'class',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `struct ${name}`,
      doc_comment: this.getDocComment(node),
      metadata: { kind: 'struct', is_exported: isPublic },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Body: methods
    const body = node.childForFieldName('body') ?? node.namedChildren.find(
      (c) => c.type === 'declaration_list',
    );
    if (body) {
      this.extractClassBody(body, source, filePath, oirId, nodes, edges);
    }
  }

  // ─── Base List (extends/implements) ───

  private extractBaseList(
    baseList: Parser.SyntaxNode,
    classOirId: string,
    edges: OIREdge[],
  ): void {
    // In C#, the first item is typically the base class, rest are interfaces
    // (but all are declared in base_list). We can't always tell them apart
    // without type resolution — so we use heuristic: interfaces start with 'I'.
    let isFirst = true;
    for (const base of baseList.namedChildren) {
      const baseName = base.type === 'generic_name'
        ? (base.childForFieldName('name')?.text ?? base.text.split('<')[0])
        : base.text;

      if (!baseName) continue;

      // C# convention: interfaces start with 'I'
      const isInterface = /^I[A-Z]/.test(baseName);

      if (isInterface) {
        edges.push({
          source_oir_id: classOirId,
          target_oir_id: `__unresolved__::${baseName}::class`,
          type: 'implements',
          metadata: { target_name: baseName },
        });
      } else if (isFirst) {
        edges.push({
          source_oir_id: classOirId,
          target_oir_id: `__unresolved__::${baseName}::class`,
          type: 'extends',
          metadata: { target_name: baseName },
        });
      }

      isFirst = false;
    }
  }

  // ─── Class Body ───

  private extractClassBody(
    body: Parser.SyntaxNode,
    source: string,
    filePath: string,
    classOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    for (const member of body.namedChildren) {
      if (
        member.type === 'method_declaration' ||
        member.type === 'constructor_declaration'
      ) {
        const nameNode = member.childForFieldName('name') ?? member.namedChildren.find(
          (c) => c.type === 'identifier',
        );
        if (!nameNode) continue;

        const name = nameNode.text;
        const startLine = member.startPosition.row + 1;
        const endLine = member.endPosition.row + 1;

        const params = this.extractMethodParams(member);
        const oirId = generateOirId(filePath, `${classOirId.slice(0, 8)}.${name}`, 'function', `${name}(${params.join(', ')})`);

        nodes.push({
          oir_id: oirId,
          type: 'function',
          name,
          file_path: filePath,
          line_start: startLine,
          line_end: endLine,
          signature: `${name}(${params.join(', ')})`,
          doc_comment: this.getDocComment(member),
          metadata: {
            is_method: true,
            is_constructor: member.type === 'constructor_declaration',
            is_exported: this.hasModifier(member, 'public'),
            params,
          },
          content_hash: hashNodeContent(source, startLine, endLine),
          code_body: extractCodeBody(source, startLine, endLine),
        });

        const methodBody = member.childForFieldName('body');
        if (methodBody) {
          this.extractCalls(methodBody, oirId, edges);
        }
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
      if (node.type === 'invocation_expression') {
        const fn = node.childForFieldName('function');
        if (fn) {
          let calleeName: string | null = null;
          if (fn.type === 'identifier') {
            calleeName = fn.text;
          } else if (fn.type === 'member_access_expression') {
            calleeName = fn.childForFieldName('name')?.text ?? null;
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
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.type === 'generic_name'
            ? (typeNode.childForFieldName('name')?.text ?? typeNode.text)
            : typeNode.text;
          edges.push({
            source_oir_id: callerOirId,
            target_oir_id: `__unresolved__::${typeName}::class`,
            type: 'calls',
            metadata: { callee: `new ${typeName}`, is_constructor: true },
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

  // ─── Helpers ───

  private hasModifier(node: Parser.SyntaxNode, modifier: string): boolean {
    const modifiers = node.childForFieldName('modifiers') ??
      node.namedChildren.find((c) => c.type === 'modifier');
    if (!modifiers) {
      // Check direct children for modifier keywords
      return node.children.some((c) => c.text === modifier);
    }
    return modifiers.children.some((c) => c.text === modifier);
  }

  private extractMethodParams(node: Parser.SyntaxNode): string[] {
    const params = node.childForFieldName('parameters') ?? node.namedChildren.find(
      (c) => c.type === 'parameter_list',
    );
    if (!params) return [];

    return params.namedChildren
      .filter((c) => c.type === 'parameter')
      .map((c) => {
        const nameNode = c.childForFieldName('name');
        const typeNode = c.childForFieldName('type');
        if (nameNode && typeNode) {
          return `${typeNode.text} ${nameNode.text}`;
        }
        return c.text;
      });
  }

  private getDocComment(node: Parser.SyntaxNode): string | null {
    // C# uses /// XML doc comments
    const comments: string[] = [];
    let sibling = node.previousSibling;

    while (sibling) {
      if (sibling.type === 'comment' && sibling.text.startsWith('///')) {
        comments.unshift(sibling.text.replace(/^\/\/\/\s?/, ''));
      } else if (sibling.type === 'comment') {
        sibling = sibling.previousSibling;
        continue;
      } else {
        break;
      }
      sibling = sibling.previousSibling;
    }

    if (comments.length > 0) {
      // Strip XML tags for clean display
      return comments
        .join('\n')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .trim();
    }

    return null;
  }
}
