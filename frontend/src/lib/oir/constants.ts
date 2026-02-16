import type { OIRNodeType, OIREdgeType } from './types';

/** OKLCH color for each OIR node type */
export const NODE_COLORS: Record<OIRNodeType, string> = {
  function: 'oklch(0.527 0.185 145.14)',    // green
  component: 'oklch(0.546 0.245 262.88)',   // blue
  route: 'oklch(0.705 0.213 47.6)',         // orange
  database_query: 'oklch(0.553 0.235 303)',  // purple
  module: 'oklch(0.637 0.025 260)',          // slate
  class: 'oklch(0.6 0.145 280)',             // indigo
  middleware: 'oklch(0.65 0.175 55)',        // amber
  event_emitter: 'oklch(0.6 0.19 200)',     // cyan
  event_listener: 'oklch(0.55 0.17 190)',   // teal
  external_api: 'oklch(0.65 0.14 340)',     // pink
  variable: 'oklch(0.65 0.06 250)',          // gray-blue
  type_def: 'oklch(0.6 0.12 310)',           // violet
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
};

/** Lucide icon name for each node type */
export const NODE_ICONS: Record<OIRNodeType, string> = {
  function: 'Braces',
  component: 'Component',
  route: 'Route',
  database_query: 'Database',
  module: 'FileCode',
  class: 'Box',
  middleware: 'Layers',
  event_emitter: 'Radio',
  event_listener: 'Antenna',
  external_api: 'Globe',
  variable: 'Variable',
  type_def: 'Type',
};

/** Edge color by type */
export const EDGE_COLORS: Record<OIREdgeType, string> = {
  calls: 'oklch(0.527 0.185 145.14)',       // green — runtime flow
  imports: 'oklch(0.6 0.03 260)',            // gray — static
  extends: 'oklch(0.6 0.145 280)',           // indigo
  implements: 'oklch(0.55 0.17 190)',        // teal
  renders: 'oklch(0.546 0.245 262.88)',      // blue
  routes_to: 'oklch(0.705 0.213 47.6)',      // orange
  queries: 'oklch(0.553 0.235 303)',         // purple
  emits_event: 'oklch(0.6 0.19 200)',        // cyan
  subscribes_to: 'oklch(0.55 0.17 190)',     // teal
  redirects_to: 'oklch(0.65 0.175 55)',      // amber
  uses: 'oklch(0.65 0.06 250)',              // gray-blue
  exports: 'oklch(0.6 0.03 260)',            // gray
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
