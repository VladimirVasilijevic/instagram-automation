import { selectCommentDeliveries } from '@instagram-automation/application';
import { evaluateComment, type RuleComment, type CommentRule } from '@instagram-automation/domain';
import { describe, expect, it } from 'vitest';

const owner = { externalId: 'owner-id', name: 'OwnerName' };
const comment: RuleComment = {
  connectionExternalId: 'owner-id',
  authorExternalId: 'visitor-id',
  authorName: 'Visitor',
  parentCommentId: null,
  text: '',
};

describe('shared comment matching policy', () => {
  it.each([
    ['exact', '#hello', '  #HeLLo  ', true],
    ['exact', 'hello', 'hello world', false],
    ['contains', 'price', 'The price, please!', true],
    ['contains', 'price', 'priceless', false],
    ['contains', '#price', 'price please', false],
    ['contains', '#price', 'Please #PRICE!', true],
    ['contains', 'цена', 'Какая цена?', true],
    ['contains', 'café', 'Un café, merci.', true],
    ['contains', 'цена', 'ценами', false],
    ['all', null, 'Anything at all', true],
  ] as const)('matches %s %s against %s with outcome %s', (mode, text, incoming, matched) => {
    expect(evaluateComment({ ...comment, text: incoming }, owner, { mode, text })).toBe(
      matched ? null : 'trigger_not_matched',
    );
  });

  it.each(['all', 'contains', 'exact'] as const)(
    'excludes owners and nested replies before %s matching',
    (mode) => {
      const rule: CommentRule = { mode, text: 'hello' };
      expect(
        evaluateComment({ ...comment, text: 'hello', parentCommentId: 'parent-id' }, owner, rule),
      ).toBe('nested_comment');
      expect(
        evaluateComment(
          { ...comment, text: 'hello', authorExternalId: owner.externalId },
          owner,
          rule,
        ),
      ).toBe('own_comment');
      expect(
        evaluateComment(
          { ...comment, text: 'hello', authorExternalId: null, authorName: 'OWNERNAME' },
          owner,
          rule,
        ),
      ).toBe('own_comment');
      expect(
        evaluateComment(
          { ...comment, text: 'hello', authorExternalId: null, authorName: null },
          owner,
          rule,
        ),
      ).toBeNull();
    },
  );
});

describe('shared delivery selection policy', () => {
  const choice = { id: 'choice-id', title: 'Yes', followUpText: 'More details' };
  it.each([
    ['public', ['public']],
    ['private', ['private']],
    ['both', ['public', 'private']],
  ] as const)('selects only enabled channels for %s mode', (deliveryMode, channels) => {
    const result = selectCommentDeliveries({
      deliveryMode,
      replyText: 'Public text',
      privateReplyText: 'Private text',
      quickReplyOptions: [choice],
    });
    expect(result.map((item) => item.deliveryChannel)).toEqual(channels);
    for (const item of result) {
      expect(item.messageText).toBe(
        item.deliveryChannel === 'public' ? 'Public text' : 'Private text',
      );
      expect(item.quickReplyOptions).toEqual(item.deliveryChannel === 'public' ? [] : [choice]);
    }
  });
  it.each(['private', 'both'] as const)(
    'rejects missing private text for %s mode',
    (deliveryMode) => {
      expect(() =>
        selectCommentDeliveries({ deliveryMode, replyText: 'Public text', privateReplyText: null }),
      ).toThrow('Private reply text is required');
    },
  );
  it('defaults absent private choices to an empty list', () => {
    expect(
      selectCommentDeliveries({
        deliveryMode: 'private',
        replyText: '',
        privateReplyText: 'Private text',
      }),
    ).toEqual([{ deliveryChannel: 'private', messageText: 'Private text', quickReplyOptions: [] }]);
  });
});
