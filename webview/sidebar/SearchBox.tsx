import { Icon } from './Icon';

/*
 * Filters the tree by title as you type.
 *
 * The reason the sidebar is a webview at all: a native VS Code TreeView cannot
 * host a text input (plan 2.2). Filtering happens locally against the tree the
 * webview already holds, so there is no round trip and no latency.
 *
 * This is title matching, not full-text search over note contents -- that is a
 * separate feature with its own index (plan 2.9).
 */

interface SearchBoxProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function SearchBox({ value, onChange }: SearchBoxProps) {
  return (
    <div className="search">
      <span className="search__icon">
        <Icon name="search" />
      </span>

      <input
        type="text"
        className="search__input"
        placeholder="Filter notes"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Escape clears rather than blurring: the filter is the thing in the
          // way, so getting rid of it is what Escape should mean here.
          if (event.key === 'Escape' && value !== '') {
            event.stopPropagation();
            onChange('');
          }
        }}
      />

      {value === '' ? null : (
        <button type="button" className="search__clear" title="Clear" onClick={() => onChange('')}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
