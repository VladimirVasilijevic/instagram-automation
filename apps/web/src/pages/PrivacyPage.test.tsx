import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrivacyPage } from './PrivacyPage.js';

describe('PrivacyPage', () => {
  it('publishes the required policy and deletion contact', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/Instagram professional account ID and username/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'wascke@gmail.com' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'wascke@gmail.com' })[0]).toHaveAttribute(
      'href',
      'mailto:wascke@gmail.com',
    );
  });
});
