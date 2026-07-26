import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Play, Search } from 'lucide-react';
import type { AgentModel, AgentProvider, AgentProviderId } from '../agentCatalog';

type ModelPickerPopoverProps = {
  /** Provider tabs on the left rail, in order. */
  providers: AgentProvider[];
  /** Every selectable model. Rows are narrowed by the active tab and the query. */
  models: AgentModel[];
  activeProviderId: AgentProviderId;
  onActiveProviderChange: (id: AgentProviderId) => void;
  search: string;
  onSearchChange: (query: string) => void;
  selectedModelId: string | null | undefined;
  onSelect: (model: AgentModel) => void;
  /**
   * Floating pill drawn over the search strip (the composer's Claude Code CLI
   * entry). The panel reserves room for it whenever it renders something.
   */
  overlay?: ReactNode;
  /** Which side of the trigger the popover unfolds on. Defaults to 'above'. */
  placement?: 'above' | 'below';
  /** Extra class on the popover, e.g. to widen or narrow a specific mount. */
  className?: string;
};

/**
 * The provider-rail model picker shared by the composer and Settings. Both
 * mounts drive it with their own tab/search/selection state so opening one
 * never disturbs the other.
 */
export const ModelPickerPopover = ({
  providers,
  models,
  activeProviderId,
  onActiveProviderChange,
  search,
  onSearchChange,
  selectedModelId,
  onSelect,
  overlay,
  placement = 'above',
  className,
}: ModelPickerPopoverProps) => {
  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((model) => {
      if (model.providerId !== activeProviderId) return false;
      if (!query) return true;
      return (
        model.label.toLowerCase().includes(query) ||
        model.providerLabel.toLowerCase().includes(query) ||
        model.slug.toLowerCase().includes(query)
      );
    });
  }, [activeProviderId, models, search]);

  // Keep the selected row in view when the popover opens on a long list. This
  // scrolls the list box by hand rather than with scrollIntoView, which walks
  // up to every scrollable ancestor and yanks the whole Settings pane.
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = selectedRowRef.current;
    if (!list || !row) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < list.scrollTop) list.scrollTop = rowTop;
    else if (rowBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = rowBottom - list.clientHeight;
    }
    // Only on mount / tab change: scrolling on every keystroke fights the user.
  }, [activeProviderId]);

  // A popover that unfolds downward hangs off a scrolling pane (Settings), so
  // it can run past the window. Flip it above the trigger when the room is
  // there — the page itself must never scroll just because a menu opened.
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [flipped, setFlipped] = useState(false);
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (placement !== 'below' || !popover) return;
    const anchor = popover.parentElement?.getBoundingClientRect();
    const rect = popover.getBoundingClientRect();
    const overflowsBelow = rect.bottom > window.innerHeight - 8;
    const roomAbove = (anchor?.top ?? 0) - 8;
    setFlipped(overflowsBelow && roomAbove >= rect.height);
  }, [placement]);

  return (
    <div
      ref={popoverRef}
      className={`model-picker-popover${placement === 'below' ? ' below' : ''}${
        flipped ? ' flip-up' : ''
      }${className ? ` ${className}` : ''}`}
    >
      <div className="model-provider-rail">
        {providers.map((provider) => {
          const Icon = provider.icon;
          return (
            <button
              key={provider.id}
              className={`provider-rail-button ${activeProviderId === provider.id ? 'active' : ''}`}
              onClick={() => onActiveProviderChange(provider.id)}
              title={provider.label}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </div>
      <div className={`model-picker-panel${overlay ? ' has-cli-overlay' : ''}`}>
        {overlay}
        <div className="model-search">
          <Search size={16} />
          <input
            autoFocus
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search models..."
          />
        </div>
        <div className="model-list" ref={listRef}>
          {visibleModels.map((model) => {
            const ProviderIcon =
              providers.find((provider) => provider.id === model.providerId)?.icon ?? Play;
            const selected = selectedModelId === model.id;
            return (
              <button
                key={model.id}
                ref={selected ? selectedRowRef : undefined}
                className={`model-row ${selected ? 'selected' : ''}`}
                onClick={() => onSelect(model)}
                disabled={model.available === false}
                title={model.unavailableReason ?? model.slug}
              >
                <ProviderIcon size={18} />
                <span className="model-row-text">
                  <span className="model-row-label">{model.label}</span>
                  <span className="model-row-provider">{model.providerLabel}</span>
                </span>
                {model.shortcut && <span className="model-shortcut">{model.shortcut}</span>}
                {selected && <Check size={15} />}
              </button>
            );
          })}
          {visibleModels.length === 0 && <div className="model-empty">No models</div>}
        </div>
      </div>
    </div>
  );
};
