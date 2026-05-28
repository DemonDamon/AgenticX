import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  children: string;
  className?: string;
  minSize?: number;
  maxSize?: number;
  title?: string;
};

/** Shrinks font size so single-line text fits its container width. */
export function FitText({
  children,
  className = "",
  minSize = 9,
  maxSize = 13,
  title,
}: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(maxSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const fit = () => {
      let size = maxSize;
      text.style.fontSize = `${size}px`;
      while (text.scrollWidth > container.clientWidth && size > minSize) {
        size -= 0.5;
        text.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children, minSize, maxSize]);

  return (
    <span
      ref={containerRef}
      className={`inline-block min-w-0 max-w-full overflow-hidden ${className}`}
      title={title ?? children}
    >
      <span
        ref={textRef}
        className="inline-block whitespace-nowrap leading-none"
        style={{ fontSize: `${fontSize}px` }}
      >
        {children}
      </span>
    </span>
  );
}
