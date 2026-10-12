/**
 * Windowed message list: only mount rows in/near the viewport.
 *
 * Author: Damon Li
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
  count: number;
  renderItem: (index: number) => ReactNode;
  getItemKey?: (index: number) => string | number;
  estimateSize?: number;
  overscan?: number;
  className?: string;
};

export function VirtualizedMessageList({
  scrollRef,
  count,
  renderItem,
  getItemKey,
  estimateSize = 96,
  overscan = 8,
  className,
}: Props) {
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScrollEl(scrollRef.current);
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => getItemKey?.(index) ?? index,
    // jsdom / first paint: avoid empty range until ResizeObserver fires
    initialRect: { width: 800, height: 600 },
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div
      className={className}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {items.map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          data-virtual-message-row="1"
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          {renderItem(virtualRow.index)}
        </div>
      ))}
    </div>
  );
}
