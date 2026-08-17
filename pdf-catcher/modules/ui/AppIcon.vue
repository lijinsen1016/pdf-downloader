<script setup lang="ts">
export type IconName =
  | 'scan'
  | 'settings'
  | 'search'
  | 'download'
  | 'open'
  | 'copy'
  | 'delete'
  | 'history'
  | 'capture'
  | 'check'
  | 'close'
  | 'file'
  | 'alert';

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), {
  size: 16
});

const paths: Record<IconName, string[]> = {
  scan: [
    'M21 21l-4.35-4.35',
    'M10.8 17.5a6.7 6.7 0 1 0 0-13.4 6.7 6.7 0 0 0 0 13.4Z'
  ],
  settings: [
    'M4 6h10',
    'M18 6h2',
    'M14 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
    'M4 12h4',
    'M12 12h8',
    'M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
    'M4 18h8',
    'M16 18h4',
    'M12 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z'
  ],
  search: ['M21 21l-4.35-4.35', 'M10.8 17.5a6.7 6.7 0 1 0 0-13.4 6.7 6.7 0 0 0 0 13.4Z'],
  download: ['M12 3v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 20h14'],
  open: ['M14 5h5v5', 'M19 5 10.5 13.5', 'M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  delete: ['M4 7h16', 'M9 7V4h6v3', 'M6.5 7 7.5 21h9l1-14', 'M10 11v6', 'M14 11v6'],
  history: ['M12 8v4l2.5 2.5', 'M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5', 'M3.5 3.5v5h5'],
  capture: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  check: ['M5 12.5 10 17.5 19 7'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  file: ['M6 2h8l4 4v16H6z', 'M14 2v5h5', 'M9 13h6', 'M9 17h6'],
  alert: ['M12 8v5', 'M12 17.5h.01', 'M12 3 2.5 20h19L12 3Z']
};
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="d in paths[props.name]" :key="d" :d="d" />
  </svg>
</template>
