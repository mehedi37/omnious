import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

// Resolve paths relative to the frontend root (two dirs up from tests/responsive/)
const frontendRoot = path.resolve(__dirname, '../..');

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(frontendRoot, relativePath), 'utf-8');
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FlowControls mobile responsiveness', () => {
  it('does not have fixed min-width that would overflow on mobile', () => {
    const source = readSource('src/components/trace/flow-controls.tsx');

    // Should have responsive width on outer container
    expect(source).toContain('w-[calc(100%-2rem)]');
    // Inner panel should use sm: prefix for min-width
    expect(source).toContain('sm:min-w-[520px]');
    // Should NOT have bare min-w-[520px] without responsive prefix
    expect(source).not.toMatch(/(?<!\bsm:)min-w-\[520px\]/);
  });
});

describe('Error page responsive padding', () => {
  it('uses responsive padding classes', () => {
    const source = readSource('src/app/dashboard/[workspaceSlug]/[projectSlug]/errors/page.tsx');

    // Should use dvh instead of vh for mobile viewport
    expect(source).toContain('100dvh');
    // Should use responsive padding
    expect(source).toContain('px-3 md:px-6');
  });
});

describe('Graph filter toolbar wrapping', () => {
  it('uses flex-wrap for mobile overflow prevention', () => {
    const source = readSource('src/components/graph/graph-filter-toolbar.tsx');
    expect(source).toContain('flex-wrap');
  });
});

describe('Graph page sheet panels responsive widths', () => {
  it('uses full width on mobile for sheet panels', () => {
    const source = readSource('src/app/dashboard/[workspaceSlug]/[projectSlug]/graph/page.tsx');

    // Sheet panels should be full width on mobile
    expect(source).toContain('w-full sm:w-95');
    // Should NOT have non-responsive w-95 alone
    expect(source).not.toMatch(/className="w-95 sm:w-105/);
  });
});
