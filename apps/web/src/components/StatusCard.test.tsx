import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusCard } from './StatusCard.js';

describe('StatusCard', () => {
  it('shows a textual state instead of relying on color alone', () => {
    render(
      <StatusCard description="The service is accepting requests." state="connected" title="API" />,
    );

    expect(screen.getByRole('heading', { name: 'API' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('The service is accepting requests.')).toBeInTheDocument();
  });
});
