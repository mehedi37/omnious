import {
  Antenna,
  Box,
  Braces,
  Component,
  Cuboid,
  Database,
  FileCode,
  FileInput,
  FolderTree,
  Globe,
  Layers,
  List,
  Package,
  Puzzle,
  Radio,
  Route,
  Shield,
  Type,
  Variable,
} from 'lucide-react';
import type { OIREdgeType, OIRNodeType } from './types';

/** Lucide icon component for each OIR node type */
export const NODE_TYPE_ICONS: Record<OIRNodeType, React.ComponentType<{ className?: string }>> = {
  function: Braces,
  component: Component,
  route: Route,
  database_query: Database,
  module: FileCode,
  class: Box,
  middleware: Layers,
  event_emitter: Radio,
  event_listener: Antenna,
  external_api: Globe,
  variable: Variable,
  type_def: Type,
  struct: Cuboid,
  enum: List,
  interface: FileInput,
  namespace: FolderTree,
  trait: Puzzle,
  protocol: Shield,
  package: Package,
};

/** Tailwind text color class for each node type */
export const NODE_TYPE_COLORS: Record<OIRNodeType, string> = {
  function: 'text-green-500',
  component: 'text-blue-500',
  route: 'text-orange-500',
  database_query: 'text-purple-500',
  module: 'text-slate-400',
  class: 'text-indigo-500',
  middleware: 'text-amber-500',
  event_emitter: 'text-cyan-500',
  event_listener: 'text-teal-500',
  external_api: 'text-pink-500',
  variable: 'text-slate-400',
  type_def: 'text-violet-500',
  struct: 'text-emerald-500',
  enum: 'text-lime-500',
  interface: 'text-teal-500',
  namespace: 'text-gray-400',
  trait: 'text-rose-500',
  protocol: 'text-sky-500',
  package: 'text-indigo-400',
};

/** OKLCH color for each OIR node type */
export const NODE_COLORS: Record<OIRNodeType, string> = {
  function: 'oklch(0.527 0.185 145.14)', // green
  component: 'oklch(0.546 0.245 262.88)', // blue
  route: 'oklch(0.705 0.213 47.6)', // orange
  database_query: 'oklch(0.553 0.235 303)', // purple
  module: 'oklch(0.637 0.025 260)', // slate
  class: 'oklch(0.6 0.145 280)', // indigo
  middleware: 'oklch(0.65 0.175 55)', // amber
  event_emitter: 'oklch(0.6 0.19 200)', // cyan
  event_listener: 'oklch(0.55 0.17 190)', // teal
  external_api: 'oklch(0.65 0.14 340)', // pink
  variable: 'oklch(0.65 0.06 250)', // gray-blue
  type_def: 'oklch(0.6 0.12 310)', // violet
  // Multi-language types
  struct: 'oklch(0.58 0.16 160)', // emerald
  enum: 'oklch(0.62 0.18 95)', // lime
  interface: 'oklch(0.55 0.17 190)', // teal
  namespace: 'oklch(0.6 0.08 260)', // cool gray
  trait: 'oklch(0.58 0.2 330)', // rose
  protocol: 'oklch(0.56 0.15 220)', // sky
  package: 'oklch(0.63 0.1 270)', // light indigo
};

/** Tailwind color class (bg-*) for each node type */
export const NODE_BG_CLASSES: Record<OIRNodeType, string> = {
  function: 'bg-green-500/10 border-green-500/30',
  component: 'bg-blue-500/10 border-blue-500/30',
  route: 'bg-orange-500/10 border-orange-500/30',
  database_query: 'bg-purple-500/10 border-purple-500/30',
  module: 'bg-slate-500/10 border-slate-500/30',
  class: 'bg-indigo-500/10 border-indigo-500/30',
  middleware: 'bg-amber-500/10 border-amber-500/30',
  event_emitter: 'bg-cyan-500/10 border-cyan-500/30',
  event_listener: 'bg-teal-500/10 border-teal-500/30',
  external_api: 'bg-pink-500/10 border-pink-500/30',
  variable: 'bg-slate-400/10 border-slate-400/30',
  type_def: 'bg-violet-500/10 border-violet-500/30',
  struct: 'bg-emerald-500/10 border-emerald-500/30',
  enum: 'bg-lime-500/10 border-lime-500/30',
  interface: 'bg-teal-500/10 border-teal-500/30',
  namespace: 'bg-gray-500/10 border-gray-500/30',
  trait: 'bg-rose-500/10 border-rose-500/30',
  protocol: 'bg-sky-500/10 border-sky-500/30',
  package: 'bg-indigo-400/10 border-indigo-400/30',
};

/** Stronger color classes for detail zoom — more visible type differentiation */
export const NODE_BG_CLASSES_STRONG: Record<OIRNodeType, string> = {
  function: 'bg-green-500/20 border-green-500/50',
  component: 'bg-blue-500/20 border-blue-500/50',
  route: 'bg-orange-500/20 border-orange-500/50',
  database_query: 'bg-purple-500/20 border-purple-500/50',
  module: 'bg-slate-500/20 border-slate-500/50',
  class: 'bg-indigo-500/20 border-indigo-500/50',
  middleware: 'bg-amber-500/20 border-amber-500/50',
  event_emitter: 'bg-cyan-500/20 border-cyan-500/50',
  event_listener: 'bg-teal-500/20 border-teal-500/50',
  external_api: 'bg-pink-500/20 border-pink-500/50',
  variable: 'bg-slate-400/20 border-slate-400/50',
  type_def: 'bg-violet-500/20 border-violet-500/50',
  struct: 'bg-emerald-500/20 border-emerald-500/50',
  enum: 'bg-lime-500/20 border-lime-500/50',
  interface: 'bg-teal-500/20 border-teal-500/50',
  namespace: 'bg-gray-500/20 border-gray-500/50',
  trait: 'bg-rose-500/20 border-rose-500/50',
  protocol: 'bg-sky-500/20 border-sky-500/50',
  package: 'bg-indigo-400/20 border-indigo-400/50',
};

/** Left border accent color for detail zoom nodes */
export const NODE_ACCENT_BORDER: Record<OIRNodeType, string> = {
  function: 'border-l-green-500',
  component: 'border-l-blue-500',
  route: 'border-l-orange-500',
  database_query: 'border-l-purple-500',
  module: 'border-l-slate-500',
  class: 'border-l-indigo-500',
  middleware: 'border-l-amber-500',
  event_emitter: 'border-l-cyan-500',
  event_listener: 'border-l-teal-500',
  external_api: 'border-l-pink-500',
  variable: 'border-l-slate-400',
  type_def: 'border-l-violet-500',
  struct: 'border-l-emerald-500',
  enum: 'border-l-lime-500',
  interface: 'border-l-teal-500',
  namespace: 'border-l-gray-500',
  trait: 'border-l-rose-500',
  protocol: 'border-l-sky-500',
  package: 'border-l-indigo-400',
};

/** Edge color by type */
export const EDGE_COLORS: Record<OIREdgeType, string> = {
  calls: 'oklch(0.527 0.185 145.14)', // green — runtime flow
  imports: 'oklch(0.6 0.03 260)', // gray — static
  extends: 'oklch(0.6 0.145 280)', // indigo
  implements: 'oklch(0.55 0.17 190)', // teal
  renders: 'oklch(0.546 0.245 262.88)', // blue
  routes_to: 'oklch(0.705 0.213 47.6)', // orange
  queries: 'oklch(0.553 0.235 303)', // purple
  emits_event: 'oklch(0.6 0.19 200)', // cyan
  subscribes_to: 'oklch(0.55 0.17 190)', // teal
  redirects_to: 'oklch(0.65 0.175 55)', // amber
  uses: 'oklch(0.65 0.06 250)', // gray-blue
  exports: 'oklch(0.6 0.03 260)', // gray
};

/** Zoom thresholds for level-of-detail rendering */
export const ZOOM_THRESHOLDS = {
  service: 0.3,
  module: 0.6,
  function: 1.0,
  detail: 1.5,
} as const;

export type ZoomLevel = keyof typeof ZOOM_THRESHOLDS;

/** HTTP method colors for route nodes */
export const HTTP_METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/20 text-green-700 dark:text-green-400',
  POST: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
  PUT: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  PATCH: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  DELETE: 'bg-red-500/20 text-red-700 dark:text-red-400',
};

/** Trace status badge styles */
export const TRACE_STATUS_STYLES: Record<string, string> = {
  ok: 'bg-green-500/20 text-green-700 dark:text-green-400',
  error: 'bg-red-500/20 text-red-700 dark:text-red-400',
  timeout: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
  partial: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
};
