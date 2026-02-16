/** ELK layout presets for the graph view */

export type LayoutPreset = 'layered-tb' | 'layered-lr' | 'force' | 'stress';

export interface LayoutPresetInfo {
  id: LayoutPreset;
  label: string;
  description: string;
  icon: string;
}

export const LAYOUT_PRESETS: LayoutPresetInfo[] = [
  {
    id: 'layered-tb',
    label: 'Top → Bottom',
    description: 'Hierarchical layout flowing downward. Best for call trees.',
    icon: 'ArrowDownUp',
  },
  {
    id: 'layered-lr',
    label: 'Left → Right',
    description: 'Hierarchical layout flowing right. Best for data pipelines.',
    icon: 'ArrowLeftRight',
  },
  {
    id: 'force',
    label: 'Force',
    description: 'Spring-based layout. Good for exploring clusters.',
    icon: 'Orbit',
  },
  {
    id: 'stress',
    label: 'Stress',
    description: 'Stress minimization. Good for balanced spacing.',
    icon: 'Grid3X3',
  },
];
