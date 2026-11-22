import type { Automation } from '../api/automation.js';
import type { RecentMedia } from '../api/media.js';

/** Selects a catalog item without coupling provider browsing to rule editing. */
export const MediaPicker = ({
  media,
  selectedMediaId,
  rules,
  disabled,
  onSelect,
}: {
  media: RecentMedia[];
  selectedMediaId: string;
  rules: Record<string, Automation>;
  disabled: boolean;
  onSelect: (mediaId: string) => void;
}) => (
  <div className="mt-3 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
    {media.map((item) => {
      const selected = item.id === selectedMediaId;
      const previewUrl = item.thumbnailUrl ?? item.mediaUrl;
      const label = item.caption?.trim() || `${item.mediaType.toLowerCase()} ${item.id}`;
      const rule = rules[item.id];
      return (
        <button
          key={item.id}
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          aria-label={`Select ${label}`}
          className={`ui-focus relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white text-left ${selected ? 'border-[#5632a8] ring-2 ring-[#5632a8]/30' : 'border-[#e6e1db]'}`}
          onClick={() => onSelect(item.id)}
        >
          {selected && (
            <span
              className="absolute top-2 right-2 rounded-full bg-[#5632a8] px-2 py-1 text-xs text-white"
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
            <div className="flex h-40 items-center justify-center bg-[#f5f2ed] text-sm text-[#625b6e]">
              Preview unavailable
            </div>
          )}
          <div className="flex flex-1 flex-col p-3">
            <p className="text-xs font-semibold uppercase text-[#5632a8]">
              {item.contentKind === 'story'
                ? 'Story'
                : item.contentKind === 'reel'
                  ? 'Reel'
                  : item.mediaType}
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-[#433d50]">
              {item.caption || 'No caption'}
            </p>
            <p className="mt-2 text-xs">
              {rule
                ? rule.enabled
                  ? 'Automation enabled'
                  : 'Automation disabled'
                : 'No automation'}
            </p>
          </div>
        </button>
      );
    })}
  </div>
);
