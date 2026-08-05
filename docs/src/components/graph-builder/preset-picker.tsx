/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useId, useRef, useState } from 'react';

interface PresetOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

interface Props {
  options: readonly PresetOption[];
  onPick: (id: string) => void;
}

/**
 * The "start from" picker.
 *
 * A listbox rather than a `<select>` because a native select's popup is drawn by
 * the platform — white and square-cornered whatever the page's theme — and the
 * builder's open menu should match the docs' surfaces like every other panel
 * here. It keeps a select's keyboard behaviour: arrows move, Enter picks, Escape
 * closes, Home/End jump to the ends.
 *
 * There is no selected value to display: picking an example loads it, and the
 * button goes back to reading as a prompt so the same one can be picked again.
 */
export const PresetPicker = ({ options, onPick }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  // Which option the keyboard is on. -1 while the pointer is driving, so no
  // option is highlighted until an arrow key is pressed.
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const close = ({ refocus = false } = {}) => {
    setIsOpen(false);
    setActiveIndex(-1);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (id: string) => {
    onPick(id);
    close({ refocus: true });
  };

  // A press outside, or the page scrolling away beneath it, dismisses the menu —
  // the behaviour a native popup has.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
      setActiveIndex(-1);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        close({ refocus: true });
      }
      return;
    }

    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex(event.key === 'ArrowUp' ? options.length - 1 : 0);
      }
      return;
    }

    const moves: Record<string, number> = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: options.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      // Wraps, so holding an arrow cycles rather than sticking at an end.
      const next = (moves[event.key] + options.length) % options.length;
      setActiveIndex(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) choose(options[activeIndex].id);
    }
  };

  return (
    <div className="gb-picker" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`gb-picker-button${isOpen ? ' is-open' : ''}`}
        // `combobox` is the role that pairs a control with a popup listbox, and
        // the role that accepts aria-activedescendant.
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        // On the button, since that is what holds focus while the menu is open.
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        onKeyDown={onKeyDown}
      >
        <span>Choose an example…</span>
        <svg
          className="gb-picker-chevron"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="gb-picker-menu"
          id={listboxId}
          role="listbox"
          aria-label="Examples to start from"
        >
          {options.map((option, index) => (
            <div
              key={option.id}
              id={`${listboxId}-${index}`}
              className={`gb-picker-option${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              // Focus stays on the button, which owns the key handling — the way
              // a native select behaves — so the options are not tab stops.
              tabIndex={-1}
              title={option.description}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.id)}
              onKeyDown={onKeyDown}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
