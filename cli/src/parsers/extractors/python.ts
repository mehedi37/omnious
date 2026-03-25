/**
 * Python extractor — tree-sitter based.
 *
 * Extracts:
 *   Nodes: module, function, class, variable, type_def
 *   Edges: imports, exports, calls, extends
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

export class PythonExtractor implements Extractor {
  readonly language = 'python' as const;

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
      doc_comment: this.getModuleDocstring(tree.rootNode),
      metadata: { extension: ext },
      content_hash: '',
      code_body: null,
    });

    const root = tree.rootNode;

    for (const child of root.namedChildren) {
      try {
        switch (child.type) {
          case 'import_statement':
          case 'import_from_statement':
            this.extractImport(child, filePath, moduleOirId, nodes, edges);
            break;

          case 'function_definition':
            this.extractFunction(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'decorated_definition': {
            const inner = child.namedChildren.find(
              (c) => c.type === 'function_definition' || c.type === 'class_definition',
            );
            if (inner?.type === 'function_definition') {
              this.extractFunction(inner, source, filePath, moduleOirId, nodes, edges, child);
            } else if (inner?.type === 'class_definition') {
              this.extractClass(inner, source, filePath, moduleOirId, nodes, edges, child);
            }
            break;
          }

          case 'class_definition':
            this.extractClass(child, source, filePath, moduleOirId, nodes, edges);
            break;

          case 'expression_statement': {
            // Top-level assignments: `x = 5`
            const expr = child.namedChildren[0];
            if (expr?.type === 'assignment') {
              this.extractAssignment(expr, source, filePath, moduleOirId, nodes, edges);
            }
            break;
          }
        }
      } catch (err) {
        errors.push({
          file_path: filePath,
          line: child.startPosition.row + 1,
          message: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // All top-level functions/classes/variables are implicitly exported in Python
    // (no private-by-default). We mark names not starting with _ as exported.
    for (const node of nodes) {
      if (node.type !== 'module' && node.type !== 'external_api') {
        const isPublic = !node.name.startsWith('_');
        if (isPublic) {
          edges.push({
            source_oir_id: moduleOirId,
            target_oir_id: node.oir_id,
            type: 'exports',
            metadata: {},
          });
        }
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
    if (node.type === 'import_statement') {
      // `import os`, `import os.path`
      const nameNode = node.childForFieldName('name') ?? node.namedChildren[0];
      if (nameNode) {
        const modName = nameNode.text.split('.')[0] ?? nameNode.text;
        const targetOirId = generateOirId(`external:${modName}`, modName, 'external_api', '');
        nodes.push({
          oir_id: targetOirId,
          type: 'external_api',
          name: modName,
          file_path: `external:${modName}`,
          line_start: null,
          line_end: null,
          signature: null,
          doc_comment: null,
          metadata: { package: nameNode.text },
          content_hash: '',
          code_body: null,
        });
        edges.push({
          source_oir_id: moduleOirId,
          target_oir_id: targetOirId,
          type: 'imports',
          metadata: { import_path: nameNode.text },
        });
      }
    } else {
      // `from x import y`
      const moduleNode = node.childForFieldName('module_name') ?? node.namedChildren[0];
      if (!moduleNode) return;

      const importPath = moduleNode.text;
      let targetOirId: string;

      if (importPath.startsWith('.')) {
        // Relative import
        const dir = path.dirname(filePath);
        const dots = importPath.match(/^\.+/)?.[0] ?? '.';
        const rest = importPath.slice(dots.length);
        const levels = dots.length - 1;
        let base = dir;
        for (let i = 0; i < levels; i++) base = path.dirname(base);
        targetOirId = rest
          ? path.join(base, ...rest.split('.')).replace(/\\/g, '/')
          : base.replace(/\\/g, '/');
      } else {
        const modName = importPath.split('.')[0] ?? importPath;
        targetOirId = generateOirId(`external:${modName}`, modName, 'external_api', '');
        nodes.push({
          oir_id: targetOirId,
          type: 'external_api',
          name: modName,
          file_path: `external:${modName}`,
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
  }

  // ─── Function Extraction ───

  private extractFunction(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    _moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    decoratedNode?: Parser.SyntaxNode,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const outer = decoratedNode ?? node;
    const startLine = outer.startPosition.row + 1;
    const endLine = outer.endPosition.row + 1;

    const params = this.extractParams(node);
    const isAsync = node.type === 'function_definition' &&
      node.previousSibling?.type === 'async';
    const decorators = this.getDecorators(decoratedNode);

    const signature = `${isAsync ? 'async ' : ''}def ${name}(${params.join(', ')})`;
    const oirId = generateOirId(filePath, name, 'function', signature);
    const docComment = this.getDocstring(node);

    nodes.push({
      oir_id: oirId,
      type: 'function',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature,
      doc_comment: docComment,
      metadata: { is_async: isAsync, params, decorators },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    // Extract calls
    const body = node.childForFieldName('body');
    if (body) {
      this.extractCalls(body, oirId, edges);
    }
  }

  // ─── Class Extraction ───

  private extractClass(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    _moduleOirId: string,
    nodes: OIRNode[],
    edges: OIREdge[],
    decoratedNode?: Parser.SyntaxNode,
  ): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const name = nameNode.text;
    const outer = decoratedNode ?? node;
    const startLine = outer.startPosition.row + 1;
    const endLine = outer.endPosition.row + 1;
    const oirId = generateOirId(filePath, name, 'class', `class ${name}`);

    const body = node.childForFieldName('body');
    const memberCount = body?.namedChildren.length ?? 0;
    const decorators = this.getDecorators(decoratedNode);

    nodes.push({
      oir_id: oirId,
      type: 'class',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `class ${name}`,
      doc_comment: this.getDocstring(node),
      metadata: { member_count: memberCount, decorators },
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });

    // Superclasses → extends edges
    const superclasses = node.childForFieldName('superclasses');
    if (superclasses) {
      for (const base of superclasses.namedChildren) {
        const baseName = base.type === 'attribute'
          ? (base.childForFieldName('attribute')?.text ?? base.text)
          : base.text;
        if (baseName && baseName !== 'object') {
          edges.push({
            source_oir_id: oirId,
            target_oir_id: `__unresolved__::${baseName}::class`,
            type: 'extends',
            metadata: { target_name: baseName },
          });
        }
      }
    }

    // Extract method calls
    if (body) {
      for (const member of body.namedChildren) {
        if (member.type === 'function_definition') {
          const methodBody = member.childForFieldName('body');
          if (methodBody) {
            this.extractCalls(methodBody, oirId, edges);
          }
        } else if (member.type === 'decorated_definition') {
          const inner = member.namedChildren.find((c) => c.type === 'function_definition');
          if (inner) {
            const methodBody = inner.childForFieldName('body');
            if (methodBody) {
              this.extractCalls(methodBody, oirId, edges);
            }
          }
        }
      }
    }
  }

  // ─── Assignment (top-level variable) ───

  private extractAssignment(
    node: Parser.SyntaxNode,
    source: string,
    filePath: string,
    _moduleOirId: string,
    nodes: OIRNode[],
    _edges: OIREdge[],
  ): void {
    const left = node.childForFieldName('left');
    if (!left || left.type !== 'identifier') return;

    const name = left.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const oirId = generateOirId(filePath, name, 'variable', `${name} = ...`);

    nodes.push({
      oir_id: oirId,
      type: 'variable',
      name,
      file_path: filePath,
      line_start: startLine,
      line_end: endLine,
      signature: `${name} = ...`,
      doc_comment: null,
      metadata: {},
      content_hash: hashNodeContent(source, startLine, endLine),
      code_body: extractCodeBody(source, startLine, endLine),
    });
  }

  // ─── Call Extraction ───

  private extractCalls(
    body: Parser.SyntaxNode,
    callerOirId: string,
    edges: OIREdge[],
  ): void {
    const walk = (node: Parser.SyntaxNode): void => {
      if (node.type === 'call') {
        const fn = node.childForFieldName('function');
        if (fn) {
          let calleeName: string | null = null;
          if (fn.type === 'identifier') {
            calleeName = fn.text;
          } else if (fn.type === 'attribute') {
            calleeName = fn.childForFieldName('attribute')?.text ?? null;
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
      .filter((c) =>
        c.type === 'identifier' ||
        c.type === 'default_parameter' ||
        c.type === 'typed_parameter' ||
        c.type === 'typed_default_parameter' ||
        c.type === 'list_splat_pattern' ||
        c.type === 'dictionary_splat_pattern',
      )
      .map((c) => {
        if (c.type === 'identifier') return c.text;
        const nameNode = c.childForFieldName('name');
        return nameNode?.text ?? c.text;
      })
      .filter((name) => name !== 'self' && name !== 'cls');
  }

  private getDocstring(node: Parser.SyntaxNode): string | null {
    const body = node.childForFieldName('body');
    if (!body) return null;

    const first = body.namedChildren[0];
    if (first?.type === 'expression_statement') {
      const str = first.namedChildren[0];
      if (str?.type === 'string' || str?.type === 'concatenated_string') {
        // Strip triple-quote markers
        return str.text
          .replace(/^("""|''')\s*/, '')
          .replace(/\s*("""|''')$/, '')
          .trim();
      }
    }
    return null;
  }

  private getModuleDocstring(root: Parser.SyntaxNode): string | null {
    const first = root.namedChildren[0];
    if (first?.type === 'expression_statement') {
      const str = first.namedChildren[0];
      if (str?.type === 'string' || str?.type === 'concatenated_string') {
        return str.text
          .replace(/^("""|''')\s*/, '')
          .replace(/\s*("""|''')$/, '')
          .trim();
      }
    }
    return null;
  }

  private getDecorators(decoratedNode?: Parser.SyntaxNode): string[] {
    if (!decoratedNode) return [];
    return decoratedNode.namedChildren
      .filter((c) => c.type === 'decorator')
      .map((c) => c.text.replace(/^@/, ''));
  }
}
