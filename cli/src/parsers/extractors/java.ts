/**
 * Java extractor — tree-sitter based.
 *
 * Extracts:
 *   Nodes: module (file), class, function (method), type_def (interface/enum), variable (field)
 *   Edges: imports, exports, calls, extends, implements
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

export class JavaExtractor implements Extractor {
  readonly language = 'java' as const;

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

    // Get package declaration
    const pkgDecl = root.namedChildren.find((c) => c.type === 'package_declaration');
    if (pkgDecl) {
      const scopedId = pkgDecl.namedChildren.find(
        (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
      );
      if (scopedId) {
        nodes[0]!.metadata = { ...nodes[0]!.metadata, package: scopedId.text };
      }
    }

    for (const child of root.namedChildren) {
      try {
        switch (child.type) {
          case 'import_declaration':
            this.extractImport(child, moduleOirId, nodes, edges);
            break;

          case 'class_declaration':
            this.extractClass(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'interface_declaration':
            this.extractInterface(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'enum_declaration':
            this.extractEnum(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'record_declaration':
            this.extractClass(child, source, filePath, moduleOirId, nodes, edges);
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

  // ─── Import ───

  private extractImport(
    node: Parser.SyntaxNode,
    moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    // import java.util.List;
    const scopedId = node.namedChildren.find(
      (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
    );
    if (!scopedId) return;

    const importPath = scopedId.text;
    const parts = importPath.split('.');
    const pkgName = parts.slice(0, Math.min(parts.length - 1, 2)).join('.');

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
  }

  // ─── Class / Record ───

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

    const oirId = generateOirId(filePath, name, 'class', startLine);

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
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Superclass → extends
    const superclass = node.childForFieldName('superclass');
    if (superclass) {
      const superName = superclass.type === 'type_identifier'
        ? superclass.text
        : (superclass.namedChildren[0]?.text ?? superclass.text);
      edges.push({
        source_oir_id: oirId,
        target_oir_id: `__unresolved__::${superName}::class`,
        type: 'extends',
        metadata: { target_name: superName },
      });
    }

    // Interfaces → implements
    const interfaces = node.childForFieldName('interfaces');
    if (interfaces) {
      for (const iface of interfaces.namedChildren) {
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

    // Body: methods and fields
    const body = node.childForFieldName('body');
    if (body) {
      this.extractClassBody(body, source, filePath, oirId, moduleOirId, nodes, edges);
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

    const oirId = generateOirId(filePath, name, 'type_def', startLine);

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
    });

    if (isPublic) {
      edges.push({
        source_oir_id: moduleOirId,
        target_oir_id: oirId,
        type: 'exports',
        metadata: {},
      });
    }

    // Extends another interface
    const extendsClause = node.childForFieldName('extends');
    if (extendsClause) {
      for (const base of extendsClause.namedChildren) {
        edges.push({
          source_oir_id: oirId,
          target_oir_id: `__unresolved__::${base.text}::class`,
          type: 'extends',
          metadata: { target_name: base.text },
        });
      }
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

    const oirId = generateOirId(filePath, name, 'type_def', startLine);

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

  // ─── Class Body (methods + fields) ───

  private extractClassBody(
    body: Parser.SyntaxNode,
    source: string,
    filePath: string,
    classOirId: string,
    _moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
  ): void {
    for (const member of body.namedChildren) {
      if (member.type === 'method_declaration' || member.type === 'constructor_declaration') {
        const nameNode = member.type === 'constructor_declaration'
          ? member.childForFieldName('name') ?? member.namedChildren.find((c) => c.type === 'identifier')
          : member.childForFieldName('name');

        if (!nameNode) continue;

        const name = nameNode.text;
        const startLine = member.startPosition.row + 1;
        const endLine = member.endPosition.row + 1;

        const oirId = generateOirId(filePath, `${classOirId.slice(0, 8)}.${name}`, 'function', startLine);
        const params = this.extractMethodParams(member);

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
        });

        // Extract calls in method body
        const methodBody = member.childForFieldName('body');
        if (methodBody) {
          this.extractCalls(methodBody, oirId, edges);
        }
      } else if (member.type === 'field_declaration') {
        // Skip field-level nodes for brevity — they bloat the graph.
        // We track method calls and class structure instead.
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
      if (node.type === 'method_invocation') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          edges.push({
            source_oir_id: callerOirId,
            target_oir_id: `__unresolved__::${nameNode.text}::function`,
            type: 'calls',
            metadata: { callee: nameNode.text },
          });
        }
      }
      if (node.type === 'object_creation_expression') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.type === 'generic_type'
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
      node.namedChildren.find((c) => c.type === 'modifiers');
    if (!modifiers) return false;
    return modifiers.children.some((c) => c.text === modifier);
  }

  private extractMethodParams(node: Parser.SyntaxNode): string[] {
    const params = node.childForFieldName('parameters');
    if (!params) return [];

    return params.namedChildren
      .filter((c) => c.type === 'formal_parameter' || c.type === 'spread_parameter')
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
    // Java uses /** ... */ Javadoc comments
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === 'block_comment' && sibling.text.startsWith('/**')) {
        return sibling.text
          .replace(/^\/\*\*\s*/, '')
          .replace(/\s*\*\/$/, '')
          .replace(/^\s*\* ?/gm, '')
          .trim();
      }
      if (sibling.type === 'line_comment') {
        sibling = sibling.previousSibling;
        continue;
      }
      break;
    }
    return null;
  }
}
