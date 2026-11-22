import { useEffect, useRef, useState } from 'react';

import { DELIVERY_MODE, TRIGGER_MODE } from '@instagram-automation/contracts';
import type { SocialProvider, SocialContentKind } from '@instagram-automation/contracts';

import {
  AutomationSaveError,
  getAutomations,
  type Automation,
  saveAutomation,
  type DeliveryMode,
  type QuickReplyOption,
  type TriggerMode,
} from '../api/automation.js';
import { getMediaPage, type RecentMedia } from '../api/media.js';
import { MediaPicker } from './MediaPicker.js';

type EditorState =
  | { status: 'loading' }
  | {
      status: 'ready';
      media: RecentMedia[];
      savedMediaUnavailable: boolean;
    }
  | { status: 'error' };

type PrivateMessageMode = 'text' | 'quick_replies';

interface Draft {
  triggerText: string;
  triggerMode: TriggerMode;
  deliveryMode: DeliveryMode;
  replyText: string;
  privateReplyText: string;
  privateMessageMode: PrivateMessageMode;
  quickReplyOptions: QuickReplyOption[];
  enabled: boolean;
}
const draftFor = (rule?: Automation, story = rule?.triggerKind === 'story_reply'): Draft => ({
  triggerText: rule?.triggerText ?? '#Hello',
  triggerMode: rule?.triggerMode ?? TRIGGER_MODE.EXACT,
  deliveryMode: story ? DELIVERY_MODE.PRIVATE : (rule?.deliveryMode ?? DELIVERY_MODE.PUBLIC),
  replyText: story ? '' : (rule?.replyText ?? 'Hello! Thanks for commenting.'),
  privateReplyText: rule?.privateReplyText ?? 'Thanks for commenting!',
  privateMessageMode: rule?.quickReplyOptions?.length ? 'quick_replies' : 'text',
  quickReplyOptions: rule?.quickReplyOptions ?? [],
  enabled: rule?.enabled ?? true,
});

/** Renders the owner-facing media, trigger, and delivery-channel automation editor. */
export const AutomationEditor = ({
  onSelectedMediaChange,
  provider = 'instagram',
}: {
  onSelectedMediaChange?: (mediaId: string | null | undefined) => void;
  provider?: SocialProvider;
} = {}) => {
  const [state, setState] = useState<EditorState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [triggerText, setTriggerText] = useState('#Hello');
  const [triggerMode, setTriggerMode] = useState<TriggerMode>(TRIGGER_MODE.EXACT);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(DELIVERY_MODE.PUBLIC);
  const [replyText, setReplyText] = useState('');
  const [privateReplyText, setPrivateReplyText] = useState('');
  const [privateMessageMode, setPrivateMessageMode] = useState<PrivateMessageMode>('text');
  const [quickReplyOptions, setQuickReplyOptions] = useState<QuickReplyOption[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<'delivery' | 'generic' | 'media' | 'reconnect' | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const drafts = useRef<Record<string, Draft>>({});
  const [rules, setRules] = useState<Record<string, Automation>>({});
  const [kind, setKind] = useState<SocialContentKind>('post');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState(false);
  const browseRequest = useRef<AbortController | null>(null);
  const applyDraft = (draft: Draft) => {
    setTriggerText(draft.triggerText);
    setTriggerMode(draft.triggerMode);
    setDeliveryMode(draft.deliveryMode);
    setReplyText(draft.replyText);
    setPrivateReplyText(draft.privateReplyText);
    setPrivateMessageMode(draft.privateMessageMode);
    setQuickReplyOptions(draft.quickReplyOptions);
    setEnabled(draft.enabled);
  };
  const selectMedia = (id: string) => {
    if (saving || id === selectedMediaId) return;
    if (selectedMediaId)
      drafts.current[selectedMediaId] = {
        triggerText,
        triggerMode,
        deliveryMode,
        replyText,
        privateReplyText,
        privateMessageMode,
        quickReplyOptions,
        enabled,
      };
    const story =
      (state.status === 'ready' &&
        state.media.find((item) => item.id === id)?.contentKind === 'story') ||
      rules[id]?.triggerKind === 'story_reply';
    applyDraft(drafts.current[id] ?? draftFor(rules[id], story));
    setSelectedMediaId(id);
    onSelectedMediaChange?.(id);
    setSaved(false);
    setSaveError(null);
  };
  const browse = async (selectedKind: SocialContentKind, cursor?: string) => {
    browseRequest.current?.abort();
    const controller = new AbortController();
    browseRequest.current = controller;
    setKind(selectedKind);
    setBrowsing(true);
    setBrowseError(false);
    try {
      const page = await getMediaPage(
        { kind: selectedKind, ...(cursor ? { cursor } : {}) },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setState((current) =>
        current.status === 'ready'
          ? {
              ...current,
              media: [
                ...new Map(
                  [...current.media, ...page.media].map((item) => [item.id, item]),
                ).values(),
              ],
            }
          : current,
      );
      setNextCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted) setBrowseError(true);
    } finally {
      if (!controller.signal.aborted) setBrowsing(false);
    }
  };
  useEffect(() => () => browseRequest.current?.abort(), []);
  const providerName = provider === 'facebook' ? 'Facebook Page' : 'Instagram';
  const reconnectPath =
    provider === 'facebook' ? '/api/connections/facebook/start' : '/api/auth/instagram/start';

  useEffect(() => {
    const controller = new AbortController();
    onSelectedMediaChange?.(undefined);
    setState({ status: 'loading' });
    setSaveError(null);
    setSaved(false);
    drafts.current = {};
    setRules({});
    setKind('post');
    setBrowseError(false);
    void Promise.all([
      getMediaPage({ kind: 'post' }, controller.signal),
      getAutomations(controller.signal),
    ])
      .then(([page, automations]) => {
        if (controller.signal.aborted) return;
        const byId = Object.fromEntries(automations.map((rule) => [rule.mediaId, rule]));
        setRules(byId);
        setNextCursor(page.nextCursor);
        setState({ status: 'ready', media: page.media, savedMediaUnavailable: false });
        const initial = automations.find((rule) =>
          page.media.some((item) => item.id === rule.mediaId),
        );
        setSelectedMediaId(initial?.mediaId ?? '');
        onSelectedMediaChange?.(initial?.mediaId ?? null);
        applyDraft(draftFor(initial));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          onSelectedMediaChange?.(null);
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [attempt, onSelectedMediaChange]);

  const selectedStory =
    (state.status === 'ready' &&
      state.media.find((item) => item.id === selectedMediaId)?.contentKind === 'story') ||
    rules[selectedMediaId]?.triggerKind === 'story_reply';
  const save = async () => {
    const trimmedTrigger = triggerText.trim();
    const triggerValid =
      triggerMode === TRIGGER_MODE.ALL ||
      (triggerMode === TRIGGER_MODE.EXACT &&
        trimmedTrigger.length >= 1 &&
        trimmedTrigger.length <= 100) ||
      (triggerMode === TRIGGER_MODE.CONTAINS && /^#?[\p{L}\p{N}_]+$/u.test(trimmedTrigger));
    const publicRequired = deliveryMode !== DELIVERY_MODE.PRIVATE;
    const privateRequired = deliveryMode !== DELIVERY_MODE.PUBLIC;
    const quickRepliesValid =
      !privateRequired ||
      privateMessageMode === 'text' ||
      (quickReplyOptions.length > 0 &&
        quickReplyOptions.every(
          (option) =>
            option.title.trim().length >= 1 &&
            option.title.trim().length <= 20 &&
            option.followUpText.trim().length >= 1 &&
            option.followUpText.trim().length <= 1000,
        ));
    if (
      !selectedMediaId ||
      (selectedStory && deliveryMode !== DELIVERY_MODE.PRIVATE) ||
      !triggerValid ||
      (publicRequired && replyText.trim() === '') ||
      (privateRequired && privateReplyText.trim() === '') ||
      !quickRepliesValid
    )
      return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const automation = await saveAutomation({
        deliveryMode,
        enabled,
        mediaId: selectedMediaId,
        privateReplyText: privateRequired ? privateReplyText.trim() : null,
        quickReplyOptions:
          privateRequired && privateMessageMode === 'quick_replies'
            ? quickReplyOptions.map((option) => ({
                ...option,
                title: option.title.trim(),
                followUpText: option.followUpText.trim(),
              }))
            : [],
        replyText: publicRequired ? replyText.trim() : '',
        triggerMode,
        triggerText: triggerMode === TRIGGER_MODE.ALL ? null : trimmedTrigger,
      });
      setRules((current) => ({ ...current, [automation.mediaId]: automation }));
      delete drafts.current[automation.mediaId];
      setDeliveryMode(automation.deliveryMode);
      setSelectedMediaId(automation.mediaId);
      setPrivateReplyText(automation.privateReplyText ?? '');
      setPrivateMessageMode(automation.quickReplyOptions?.length ? 'quick_replies' : 'text');
      setQuickReplyOptions(automation.quickReplyOptions ?? []);
      setReplyText(automation.replyText);
      setTriggerMode(automation.triggerMode);
      setTriggerText(automation.triggerText ?? '#Hello');
      setEnabled(automation.enabled);
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof AutomationSaveError
          ? error.code === 'INSTAGRAM_RECONNECT_REQUIRED' ||
            error.code === 'FACEBOOK_RECONNECT_REQUIRED'
            ? 'reconnect'
            : error.code === 'FACEBOOK_MEDIA_UNAVAILABLE'
              ? 'media'
              : 'delivery'
          : 'generic',
      );
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <section className="ui-card p-5 sm:p-6" aria-busy="true" aria-live="polite">
        <p role="status" className="text-slate-600">
          Loading your recent posts and automation settings…
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="ui-card p-5 sm:p-6" aria-live="polite">
        <p role="alert" className="ui-alert ui-alert-error">
          We could not load your posts or automation settings. Please try again.
        </p>
        <button className="ui-button mt-5" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  }

  const publicRequired = deliveryMode !== DELIVERY_MODE.PRIVATE;
  const privateRequired = deliveryMode !== DELIVERY_MODE.PUBLIC;
  const selectedItem = state.media.find((item) => item.id === selectedMediaId);
  const currentDraft: Draft = {
    triggerText,
    triggerMode,
    deliveryMode,
    replyText,
    privateReplyText,
    privateMessageMode,
    quickReplyOptions,
    enabled,
  };
  const unsaved =
    Boolean(selectedMediaId) &&
    JSON.stringify(currentDraft) !==
      JSON.stringify(draftFor(rules[selectedMediaId], selectedStory));
  const trimmedTrigger = triggerText.trim();
  const triggerValid =
    triggerMode === TRIGGER_MODE.ALL ||
    (triggerMode === TRIGGER_MODE.EXACT &&
      trimmedTrigger.length >= 1 &&
      trimmedTrigger.length <= 100) ||
    (triggerMode === TRIGGER_MODE.CONTAINS && /^#?[\p{L}\p{N}_]+$/u.test(trimmedTrigger));
  const canSave =
    Boolean(selectedMediaId) &&
    (!selectedStory || deliveryMode === DELIVERY_MODE.PRIVATE) &&
    (!enabled || state.media.some((item) => item.id === selectedMediaId)) &&
    triggerValid &&
    (!publicRequired || replyText.trim() !== '') &&
    (!privateRequired || privateReplyText.trim() !== '') &&
    (!privateRequired ||
      privateMessageMode === 'text' ||
      (quickReplyOptions.length > 0 &&
        quickReplyOptions.every(
          (option) =>
            option.title.trim().length >= 1 &&
            option.title.trim().length <= 20 &&
            option.followUpText.trim().length >= 1 &&
            option.followUpText.trim().length <= 1000,
        ))) &&
    !saving;
  return (
    <section className="ui-card p-5 sm:p-6" aria-live="polite" aria-labelledby="automation-heading">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold tracking-wide text-[#5632a8] uppercase">
          Automation setup
        </p>
        <h2 id="automation-heading" className="mt-1 text-xl font-semibold text-[#292638]">
          Create your automation
        </h2>
        <p className="mt-2 leading-6 text-[#625b6e]">
          Choose a post, reel or Story and configure its own rule and replies.
        </p>
        {selectedMediaId && (
          <p className="mt-2 text-sm text-[#625b6e]">
            Editing: {selectedItem?.caption || selectedMediaId}
            {unsaved ? ' · Unsaved changes' : ''}
          </p>
        )}
      </div>

      <fieldset className="mt-6" disabled={saving}>
        <legend className="text-sm font-semibold text-[#292638]">
          1. Select one post, reel or Story
        </legend>
        <div className="mt-3 flex gap-3" role="group" aria-label="Content sections">
          <button
            className="ui-button-secondary"
            aria-pressed={kind === 'post'}
            onClick={() => void browse('post')}
          >
            Posts
          </button>
          <button
            className="ui-button-secondary"
            aria-pressed={kind === 'reel'}
            disabled={provider === 'facebook'}
            onClick={() => void browse('reel')}
          >
            Reels
          </button>
          <button
            className="ui-button-secondary"
            aria-pressed={kind === 'story'}
            disabled={provider === 'facebook'}
            onClick={() => void browse('story')}
          >
            Stories
          </button>
        </div>
        {provider === 'facebook' && (
          <p className="mt-2 text-sm text-[#625b6e]">
            Facebook Reels and Stories automation is not available yet.
          </p>
        )}
        {browsing && (
          <p role="status">
            Loading {kind === 'story' ? 'Stories' : kind === 'post' ? 'posts' : 'reels'}…
          </p>
        )}
        {browseError && (
          <p role="alert">We could not load this section. Select the section again to retry.</p>
        )}
        {!browsing &&
          !browseError &&
          state.media.filter((item) => item.contentKind === kind).length === 0 && (
            <p className="ui-alert ui-alert-warning mt-4">
              No {providerName} {kind === 'story' ? 'Stories' : kind === 'post' ? 'posts' : 'reels'}{' '}
              are available yet.
            </p>
          )}
        <MediaPicker
          media={state.media.filter((item) => item.contentKind === kind)}
          selectedMediaId={selectedMediaId}
          rules={rules}
          disabled={saving}
          onSelect={selectMedia}
        />
        {nextCursor && !browseError && (
          <button
            className="ui-button-secondary mt-3"
            disabled={browsing}
            onClick={() => void browse(kind, nextCursor)}
          >
            Load more {kind === 'story' ? 'Stories' : kind === 'post' ? 'posts' : 'reels'}
          </button>
        )}
      </fieldset>
      {Object.values(rules).some(
        (rule) => !state.media.some((item) => item.id === rule.mediaId),
      ) && (
        <fieldset className="mt-5" disabled={saving}>
          <legend className="font-semibold">Other saved automations</legend>
          <p className="mt-2 text-sm">
            This saved content is outside the loaded catalog. Select a rule to review it or disable
            it.
          </p>
          {Object.values(rules)
            .filter((rule) => !state.media.some((item) => item.id === rule.mediaId))
            .map((rule) => (
              <button
                key={rule.mediaId}
                className="ui-button-secondary mt-2 mr-2"
                aria-pressed={selectedMediaId === rule.mediaId}
                onClick={() => selectMedia(rule.mediaId)}
              >
                Select saved {rule.triggerKind === 'story_reply' ? 'Story' : 'post'} {rule.mediaId}{' '}
                · {rule.enabled ? 'Enabled' : 'Disabled'}
              </button>
            ))}
        </fieldset>
      )}
      {selectedMediaId && !state.media.some((item) => item.id === selectedMediaId) && (
        <p role="alert" className="ui-alert ui-alert-warning mt-4">
          This saved {selectedStory ? 'Story' : 'post'} is outside the loaded catalog. Disable its
          automation or load the content before enabling changes.
        </p>
      )}
      {selectedMediaId && (
        <p className="mt-3 text-sm">
          Editing{' '}
          {state.media.find((item) => item.id === selectedMediaId)?.caption || selectedMediaId}.
          Changes apply only to this post.
        </p>
      )}

      <div className="mt-8 grid gap-6 border-t border-[var(--app-border)] pt-6 lg:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-semibold text-[#292638]">
            {selectedStory ? '2. Story reply trigger' : '2. Comment trigger'}
          </legend>
          <div className="mt-2 grid gap-2">
            {(
              [
                [TRIGGER_MODE.EXACT, 'Exact text'],
                [TRIGGER_MODE.CONTAINS, 'Contains whole word or hashtag'],
                [TRIGGER_MODE.ALL, selectedStory ? 'Every Story reply' : 'Every top-level comment'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--app-border)] bg-white p-3 text-sm text-[#292638] has-[:checked]:border-[#5632a8] has-[:checked]:bg-[#f4effb]"
              >
                <input
                  type="radio"
                  name="trigger-mode"
                  value={value}
                  checked={triggerMode === value}
                  onChange={() => {
                    setTriggerMode(value);
                    setSaved(false);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {triggerMode !== TRIGGER_MODE.ALL && (
            <label className="mt-3 block">
              <span className="text-sm font-medium text-[#292638]">
                {triggerMode === TRIGGER_MODE.EXACT ? 'Text to match' : 'Word or hashtag'}
              </span>
              <input
                aria-label={selectedStory ? 'Story reply trigger text' : 'Comment trigger text'}
                className="ui-input mt-2 block"
                value={triggerText}
                onChange={(event) => {
                  setTriggerText(event.target.value);
                  setSaved(false);
                }}
              />
              <span className="mt-2 block text-sm text-[#625b6e]">
                {triggerMode === TRIGGER_MODE.EXACT
                  ? selectedStory
                    ? 'The complete Story reply must match. Capitalization and surrounding spaces are ignored.'
                    : 'The complete comment must match. Capitalization and surrounding spaces are ignored.'
                  : 'Enter one complete word or hashtag. Capitalization is ignored.'}
              </span>
            </label>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-[#292638]">3. Reply delivery</legend>
          <div className="mt-2 grid gap-2">
            {(
              [
                ...(selectedStory ? [] : ([[DELIVERY_MODE.PUBLIC, 'Public reply only']] as const)),
                [DELIVERY_MODE.PRIVATE, 'Private DM only'],
                ...(selectedStory
                  ? []
                  : ([[DELIVERY_MODE.BOTH, 'Public reply and private DM']] as const)),
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--app-border)] bg-white p-3 text-sm text-[#292638] has-[:checked]:border-[#5632a8] has-[:checked]:bg-[#f4effb]"
              >
                <input
                  type="radio"
                  name="delivery-mode"
                  value={value}
                  checked={deliveryMode === value}
                  onChange={() => {
                    setDeliveryMode(value);
                    setSaved(false);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 border-t border-[var(--app-border)] pt-6">
        <p className="mb-3 text-sm font-semibold text-[#292638]">4. Write your message</p>
        <div className="grid gap-6 lg:grid-cols-2">
          {publicRequired && (
            <label className="block">
              <span className="text-sm font-semibold text-[#292638]">Public reply</span>
              <textarea
                aria-label="Public reply"
                className="ui-input mt-2 block min-h-28"
                value={replyText}
                onChange={(event) => {
                  setReplyText(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
          )}
          {privateRequired && (
            <div className="block">
              <fieldset className="mb-5">
                <legend className="text-sm font-semibold text-[#292638]">Private DM format</legend>
                <div className="mt-2 grid gap-2">
                  {(
                    [
                      ['text', 'Private message only'],
                      ['quick_replies', 'Prompt with quick replies'],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--app-border)] bg-white p-3 text-sm text-[#292638] has-[:checked]:border-[#5632a8] has-[:checked]:bg-[#f4effb]"
                    >
                      <input
                        type="radio"
                        name="private-message-mode"
                        value={value}
                        checked={privateMessageMode === value}
                        onChange={() => {
                          setPrivateMessageMode(value);
                          setSaved(false);
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="text-sm font-semibold text-[#292638]">
                  {privateMessageMode === 'quick_replies'
                    ? 'Quick reply prompt'
                    : 'Private message'}
                </span>
                <textarea
                  aria-label={
                    privateMessageMode === 'quick_replies'
                      ? 'Quick reply prompt'
                      : 'Private message'
                  }
                  className="ui-input mt-2 block min-h-28"
                  value={privateReplyText}
                  onChange={(event) => {
                    setPrivateReplyText(event.target.value);
                    setSaved(false);
                  }}
                />
                <span className="mt-2 block text-sm text-[#625b6e]">
                  {selectedStory
                    ? 'A private reply is sent when a person replies to this Story and their text matches your rule.'
                    : 'One private reply can be sent for each qualifying comment.'}
                </span>
              </label>
              {privateMessageMode === 'quick_replies' && (
                <div className="mt-5 border-t border-[var(--app-border)] pt-4">
                  <h3 className="text-sm font-semibold text-[#292638]">Quick replies</h3>
                  <p className="mt-1 text-sm text-[#625b6e]">
                    Add at least one choice to this DM. Each choice can send one follow-up message
                    after the person taps it. Check the buttons in the {providerName} app.
                  </p>
                  <div className="mt-3 grid gap-3">
                    {quickReplyOptions.map((option, index) => (
                      <div
                        key={option.id}
                        className="rounded-xl border border-[var(--app-border)] bg-white p-3"
                      >
                        <label className="block text-sm font-medium text-[#292638]">
                          Quick reply {index + 1}
                          <input
                            className="ui-input mt-2 block"
                            maxLength={20}
                            value={option.title}
                            onChange={(event) => {
                              setQuickReplyOptions((current) =>
                                current.map((item) =>
                                  item.id === option.id
                                    ? { ...item, title: event.target.value }
                                    : item,
                                ),
                              );
                              setSaved(false);
                            }}
                          />
                        </label>
                        <label className="mt-3 block text-sm font-medium text-[#292638]">
                          Follow-up for reply {index + 1}
                          <textarea
                            className="ui-input mt-2 block min-h-24"
                            maxLength={1000}
                            value={option.followUpText}
                            onChange={(event) => {
                              setQuickReplyOptions((current) =>
                                current.map((item) =>
                                  item.id === option.id
                                    ? { ...item, followUpText: event.target.value }
                                    : item,
                                ),
                              );
                              setSaved(false);
                            }}
                          />
                        </label>
                        <button
                          className="ui-button-secondary mt-3"
                          type="button"
                          aria-label={`Remove quick reply ${index + 1}`}
                          onClick={() => {
                            setQuickReplyOptions((current) =>
                              current.filter((item) => item.id !== option.id),
                            );
                            setSaved(false);
                          }}
                        >
                          Remove choice
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    className="ui-button-secondary mt-3"
                    type="button"
                    disabled={quickReplyOptions.length >= 13}
                    onClick={() => {
                      setQuickReplyOptions((current) => [
                        ...current,
                        { id: crypto.randomUUID(), title: '', followUpText: '' },
                      ]);
                      setSaved(false);
                    }}
                  >
                    Add quick reply
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-[#f5f2ed] p-3 text-sm font-medium text-[#292638]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setSaved(false);
          }}
        />
        Enable automatic reply
      </label>

      {saveError === 'generic' && (
        <p role="alert" className="ui-alert ui-alert-error mt-4">
          We could not save your automation. Please try again.
        </p>
      )}
      {saveError === 'delivery' && (
        <p role="alert" className="ui-alert ui-alert-error mt-4">
          Comment delivery could not be enabled. Your changes were not saved. Previous automation
          settings, if any, remain active.
        </p>
      )}
      {saveError === 'media' && (
        <p role="alert" className="ui-alert ui-alert-error mt-4">
          The selected Facebook post could not be verified. Your changes were not saved. Choose a
          current post and try again.
        </p>
      )}
      {saveError === 'reconnect' && (
        <div role="alert" className="ui-alert ui-alert-warning mt-4">
          <p>
            Reconnect {providerName} before enabling this automation. Your changes were not saved.
          </p>
          <a className="ui-button mt-3 w-full sm:w-auto" href={reconnectPath}>
            Reconnect {providerName}
          </a>
        </div>
      )}
      {saved && (
        <p role="status" className="ui-alert ui-alert-success mt-4">
          Automation saved.
        </p>
      )}
      <button
        className="ui-button mt-6 w-full sm:w-auto"
        disabled={!canSave}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save automation'}
      </button>
    </section>
  );
};
