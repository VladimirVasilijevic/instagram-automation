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

const primaryButtonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

const mediaLabel = (item: RecentMedia): string =>
  item.caption?.trim() || `${item.mediaType.toLowerCase()} ${item.id}`;

/** Renders the owner-facing media, trigger, and delivery-channel automation editor. */
export const AutomationEditor = () => {
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
        setSelectedMediaId(savedMediaUnavailable ? '' : (automation?.mediaId ?? ''));
        setTriggerText(automation?.triggerText ?? '#Hello');
        setDeliveryMode(automation?.deliveryMode ?? DELIVERY_MODE.PUBLIC);
        setReplyText(automation?.replyText ?? 'Hello! Thanks for commenting.');
        setPrivateReplyText(automation?.privateReplyText ?? 'Thanks for commenting!');
        setEnabled(automation?.enabled ?? true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

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
      <section className="mt-8" aria-busy="true" aria-live="polite">
        <p role="status" className="text-slate-600">
          Loading your recent posts and automation settings…
        </p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="mt-8" aria-live="polite">
        <p role="alert" className="text-slate-700">
          We could not load your posts or automation settings. Please try again.
        </p>
        <button
          className={`${primaryButtonStyle} mt-5`}
          onClick={() => setAttempt((value) => value + 1)}
        >
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
    <section className="mt-8 border-t border-slate-200 pt-8" aria-live="polite">
      <div className="max-w-2xl">
        <h3 className="text-xl font-semibold text-slate-950">Create your automation</h3>
        <p className="mt-2 leading-7 text-slate-600">
          Choose one recent post, a hashtag trigger, and where matching replies should be sent.
        </p>
      </div>

      {state.media.length === 0 ? (
        <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          No recent Instagram posts are available yet. Create a post, then try again.
        </p>
      ) : (
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold text-slate-950">Select one post</legend>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.media.map((item) => {
              const selected = item.id === selectedMediaId;
              const previewUrl = item.thumbnailUrl ?? item.mediaUrl;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${mediaLabel(item)}`}
                  className={`overflow-hidden rounded-xl border text-left transition focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none ${
                    selected
                      ? 'border-indigo-600 ring-2 ring-indigo-600 ring-offset-2'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                  onClick={() => {
                    setSelectedMediaId(item.id);
                    setSaved(false);
                  }}
                >
                  {previewUrl ? (
                    <img
                      className="aspect-square w-full bg-slate-100 object-cover"
                      src={previewUrl}
                      alt={item.caption?.trim() || `${item.mediaType} preview`}
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-slate-100 text-sm text-slate-500">
                      Preview unavailable
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-xs font-semibold tracking-wide text-indigo-700 uppercase">
                      {item.mediaType}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700">
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
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Your saved post is no longer among the 12 most recent posts. Select a current post before
          saving changes.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-slate-950">Comment trigger</span>
          <input
            aria-label="Comment trigger"
            className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-slate-950 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600 focus:outline-none"
            value={triggerText}
            onChange={(event) => {
              setTriggerText(event.target.value);
              setSaved(false);
            }}
          />
          <span className="mt-2 block text-sm text-slate-600">
            Use one hashtag without spaces. Matching ignores capitalization and surrounding spaces.
          </span>
        </label>
        <fieldset>
          <legend className="text-sm font-semibold text-slate-950">Reply delivery</legend>
          <div className="mt-2 grid gap-2">
            {(
              [
                [DELIVERY_MODE.PUBLIC, 'Public reply only'],
                [DELIVERY_MODE.PRIVATE, 'Private DM only'],
                [DELIVERY_MODE.BOTH, 'Public reply and private DM'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-3 text-sm text-slate-800">
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {publicRequired && (
          <label className="block">
            <span className="text-sm font-semibold text-slate-950">Public reply</span>
            <textarea
              aria-label="Public reply"
              className="mt-2 block min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-950 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600 focus:outline-none"
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
            <span className="text-sm font-semibold text-slate-950">Private message</span>
            <textarea
              aria-label="Private message"
              className="mt-2 block min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-950 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600 focus:outline-none"
              value={privateReplyText}
              onChange={(event) => {
                setPrivateReplyText(event.target.value);
                setSaved(false);
              }}
            />
            <span className="mt-2 block text-sm text-slate-600">
              Instagram permits one private reply for each qualifying comment.
            </span>
          </label>
        )}
      </div>

      <label className="mt-6 flex items-center gap-3 text-sm font-medium text-slate-950">
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
        <p role="alert" className="mt-4 text-sm text-red-800">
          We could not save your automation. Please try again.
        </p>
      )}
      {saved && (
        <p role="status" className="mt-4 text-sm text-emerald-800">
          Automation saved.
        </p>
      )}
      <button
        className={`${primaryButtonStyle} mt-6`}
        disabled={!canSave}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save automation'}
      </button>
    </section>
  );
};
