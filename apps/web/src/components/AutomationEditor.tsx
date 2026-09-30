import { useEffect, useState } from 'react';

import { DELIVERY_MODE } from '@instagram-automation/contracts';

import { getAutomation, saveAutomation, type DeliveryMode } from '../api/automation.js';
import { getRecentMedia, type RecentMedia } from '../api/media.js';

type EditorState =
  | { status: 'loading' }
  | {
      status: 'ready';
      media: RecentMedia[];
      savedMediaUnavailable: boolean;
    }
  | { status: 'error' };

const mediaLabel = (item: RecentMedia): string =>
  item.caption?.trim() || `${item.mediaType.toLowerCase()} ${item.id}`;

/** Renders the owner-facing media, trigger, and delivery-channel automation editor. */
export const AutomationEditor = ({
  onSelectedMediaChange,
}: {
  onSelectedMediaChange?: (mediaId: string | null | undefined) => void;
} = {}) => {
  const [state, setState] = useState<EditorState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selectedMediaId, setSelectedMediaId] = useState('');
  const [triggerText, setTriggerText] = useState('#Hello');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(DELIVERY_MODE.PUBLIC);
  const [replyText, setReplyText] = useState('');
  const [privateReplyText, setPrivateReplyText] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    onSelectedMediaChange?.(undefined);
    setState({ status: 'loading' });
    setSaveError(false);
    setSaved(false);
    void Promise.all([getRecentMedia(controller.signal), getAutomation(controller.signal)])
      .then(([media, automation]) => {
        if (controller.signal.aborted) return;
        const savedMediaUnavailable = Boolean(
          automation && !media.some((item) => item.id === automation.mediaId),
        );
        setState({ status: 'ready', media, savedMediaUnavailable });
        const initialMediaId = savedMediaUnavailable ? null : (automation?.mediaId ?? null);
        setSelectedMediaId(initialMediaId ?? '');
        onSelectedMediaChange?.(initialMediaId);
        setTriggerText(automation?.triggerText ?? '#Hello');
        setDeliveryMode(automation?.deliveryMode ?? DELIVERY_MODE.PUBLIC);
        setReplyText(automation?.replyText ?? 'Hello! Thanks for commenting.');
        setPrivateReplyText(automation?.privateReplyText ?? 'Thanks for commenting!');
        setEnabled(automation?.enabled ?? true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          onSelectedMediaChange?.(null);
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [attempt, onSelectedMediaChange]);

  const save = async () => {
    const trimmedTrigger = triggerText.trim();
    const publicRequired = deliveryMode !== DELIVERY_MODE.PRIVATE;
    const privateRequired = deliveryMode !== DELIVERY_MODE.PUBLIC;
    if (
      !selectedMediaId ||
      !/^#\S{1,99}$/.test(trimmedTrigger) ||
      (publicRequired && replyText.trim() === '') ||
      (privateRequired && privateReplyText.trim() === '')
    )
      return;
    setSaving(true);
    setSaveError(false);
    setSaved(false);
    try {
      const automation = await saveAutomation({
        deliveryMode,
        enabled,
        mediaId: selectedMediaId,
        privateReplyText: privateRequired ? privateReplyText.trim() : null,
        replyText: publicRequired ? replyText.trim() : '',
        triggerText: trimmedTrigger,
      });
      setDeliveryMode(automation.deliveryMode);
      setSelectedMediaId(automation.mediaId);
      setPrivateReplyText(automation.privateReplyText ?? '');
      setReplyText(automation.replyText);
      setTriggerText(automation.triggerText);
      setEnabled(automation.enabled);
      setSaved(true);
    } catch {
      setSaveError(true);
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
  const triggerValid = /^#\S{1,99}$/.test(triggerText.trim());
  const canSave =
    Boolean(selectedMediaId) &&
    triggerValid &&
    (!publicRequired || replyText.trim() !== '') &&
    (!privateRequired || privateReplyText.trim() !== '') &&
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
          Choose one recent post, a hashtag trigger, and where matching replies should be sent.
        </p>
      </div>

      {state.media.length === 0 ? (
        <p className="ui-alert ui-alert-warning mt-6">
          No recent Instagram posts are available yet. Create a post, then try again.
        </p>
      ) : (
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold text-[#292638]">1. Select one post</legend>
          <p className="mt-1 text-sm text-[#625b6e]">
            Choose the post whose comments should trigger this automation.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {state.media.map((item) => {
              const selected = item.id === selectedMediaId;
              const previewUrl = item.thumbnailUrl ?? item.mediaUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${mediaLabel(item)}`}
                  className={`ui-focus relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left transition hover:border-[#977bc3] ${
                    selected ? 'border-[#5632a8] ring-2 ring-[#5632a8]/30' : 'border-[#e6e1db]'
                  }`}
                  onClick={() => {
                    setSelectedMediaId(item.id);
                    onSelectedMediaChange?.(item.id);
                    setSaved(false);
                  }}
                >
                  {selected && (
                    <span
                      className="absolute top-2 right-2 z-10 rounded-full bg-[#5632a8] px-2 py-1 text-xs font-semibold text-white"
                      aria-hidden="true"
                    >
                      Selected
                    </span>
                  )}
                  {previewUrl ? (
                    <img
                      className="h-40 w-full bg-[#f5f2ed] object-cover"
                      src={previewUrl}
                      alt={item.caption?.trim() || `${item.mediaType} preview`}
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center bg-[#f5f2ed] text-sm text-[#625b6e]">
                      Preview unavailable
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-3">
                    <p className="text-xs font-semibold tracking-wide text-[#5632a8] uppercase">
                      {item.mediaType}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-[#433d50]">
                      {item.caption || 'No caption'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {state.savedMediaUnavailable && (
        <p role="alert" className="ui-alert ui-alert-warning mt-4">
          Your saved post is no longer among the 12 most recent posts. Select a current post before
          saving changes.
        </p>
      )}

      <div className="mt-8 grid gap-6 border-t border-[var(--app-border)] pt-6 lg:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-[#292638]">2. Comment trigger</span>
          <input
            aria-label="Comment trigger"
            className="ui-input mt-2 block"
            value={triggerText}
            onChange={(event) => {
              setTriggerText(event.target.value);
              setSaved(false);
            }}
          />
          <span className="mt-2 block text-sm text-[#625b6e]">
            Use one hashtag without spaces. Matching ignores capitalization and surrounding spaces.
          </span>
        </label>
        <fieldset>
          <legend className="text-sm font-semibold text-[#292638]">3. Reply delivery</legend>
          <div className="mt-2 grid gap-2">
            {(
              [
                [DELIVERY_MODE.PUBLIC, 'Public reply only'],
                [DELIVERY_MODE.PRIVATE, 'Private DM only'],
                [DELIVERY_MODE.BOTH, 'Public reply and private DM'],
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
            <label className="block">
              <span className="text-sm font-semibold text-[#292638]">Private message</span>
              <textarea
                aria-label="Private message"
                className="ui-input mt-2 block min-h-28"
                value={privateReplyText}
                onChange={(event) => {
                  setPrivateReplyText(event.target.value);
                  setSaved(false);
                }}
              />
              <span className="mt-2 block text-sm text-[#625b6e]">
                Instagram permits one private reply for each qualifying comment.
              </span>
            </label>
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

      {saveError && (
        <p role="alert" className="ui-alert ui-alert-error mt-4">
          We could not save your automation. Please try again.
        </p>
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
