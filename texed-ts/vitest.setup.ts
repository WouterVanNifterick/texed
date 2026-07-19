import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL only auto-cleans when afterEach is a global; vitest globals are off here.
afterEach(() => cleanup());
