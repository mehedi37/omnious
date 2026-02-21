import { ComponentNode } from './component-node';
import { DatabaseNode } from './database-node';
import { ErrorNode } from './error-node';
import { FunctionNode } from './function-node';
import { GroupNode } from './group-node';
import { ModuleNode } from './module-node';
import { RouteNode } from './route-node';
import { ServiceNode } from './service-node';

/**
 * Module-level nodeTypes constant — MUST be defined outside component
 * to prevent React Flow from re-registering on every render.
 */
export const nodeTypes = {
  service: ServiceNode,
  module: ModuleNode,
  function: FunctionNode,
  component: ComponentNode,
  route: RouteNode,
  database: DatabaseNode,
  error: ErrorNode,
  group: GroupNode,
} as const;
