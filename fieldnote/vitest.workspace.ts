import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/db',
  'packages/ai',
  'packages/pdf',
  'apps/web',
  'apps/worker',
]);
