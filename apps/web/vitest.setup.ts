import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// server-only is a build-time guard for Next.js; a no-op under vitest.
vi.mock('server-only', () => ({}));

afterEach(() => {
  cleanup();
});
