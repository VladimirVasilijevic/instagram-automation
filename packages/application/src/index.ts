import {
  DELIVERY_CHANNEL,
  DELIVERY_MODE,
  type DeliveryChannel,
  type DeliveryMode,
} from '@instagram-automation/contracts';

/** A choice offered in a private reply and its configured branch message. */
export interface ReplyChoice {
  /** Stable choice identifier included in its provider payload. */
  id: string;
  /** Visible choice label. */
  title: string;
  /** Message sent when the choice is selected. */
  followUpText: string;
}

/** Provider-independent configuration for reply channel selection. */
export interface ReplyConfiguration {
  /** Which channels the owner enabled. */
  deliveryMode: DeliveryMode;
  /** Text for a public comment reply. */
  replyText: string;
  /** Text for a private message, when enabled. */
  privateReplyText: string | null;
  /** Choices attached to a private message. */
  quickReplyOptions?: ReplyChoice[];
}

/** One immutable delivery request selected for a matching comment. */
export interface SelectedDelivery {
  /** Public comment or private message. */
  deliveryChannel: DeliveryChannel;
  /** Text that must be snapshotted before dispatch. */
  messageText: string;
  /** Choice configuration snapshotted for a private reply. */
  quickReplyOptions: ReplyChoice[];
}

/** Expands an owner's mode into independently tracked delivery channels. */
export const selectCommentDeliveries = (configuration: ReplyConfiguration): SelectedDelivery[] => {
  const selected: SelectedDelivery[] = [];
  if (
    configuration.deliveryMode === DELIVERY_MODE.PUBLIC ||
    configuration.deliveryMode === DELIVERY_MODE.BOTH
  ) {
    selected.push({
      deliveryChannel: DELIVERY_CHANNEL.PUBLIC,
      messageText: configuration.replyText,
      quickReplyOptions: [],
    });
  }
  if (
    configuration.deliveryMode === DELIVERY_MODE.PRIVATE ||
    configuration.deliveryMode === DELIVERY_MODE.BOTH
  ) {
    if (configuration.privateReplyText === null)
      throw new Error('Private reply text is required for a private delivery');
    selected.push({
      deliveryChannel: DELIVERY_CHANNEL.PRIVATE,
      messageText: configuration.privateReplyText,
      quickReplyOptions: configuration.quickReplyOptions ?? [],
    });
  }
  return selected;
};
