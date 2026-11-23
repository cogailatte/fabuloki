"use client";

import { useState } from "react";

export interface CollapseGroup<K extends string> {

  isCollapsed: (key: K) => boolean;

  toggle: (key: K) => void;

  set: (key: K, collapsed: boolean) => void;

  reset: () => void;

  anyCollapsed: boolean;

  touched: boolean;
}

export function useCollapseGroup<K extends string>({
  keys,
  finished,
  keepExpanded,
  configured,
}: {

  keys: readonly K[];

  finished: boolean;

  configured?: (key: K) => boolean;

  keepExpanded?: readonly K[];
}): CollapseGroup<K> {

  const [override, setOverride] = useState<Partial<Record<K, boolean>>>({});

  const defaultCollapsed = (key: K): boolean => {
    if ((keepExpanded ?? []).includes(key)) return false;
    return finished || configured?.(key) === true;
  };

  const isCollapsed = (key: K): boolean =>
    override[key] ?? defaultCollapsed(key);

  const set = (key: K, collapsed: boolean) => {
    setOverride((o) => ({ ...o, [key]: collapsed }));
  };

  const toggle = (key: K) => {

    setOverride((o) => ({ ...o, [key]: !(o[key] ?? defaultCollapsed(key)) }));
  };

  return {
    isCollapsed,
    toggle,
    set,
    reset: () => setOverride({}),
    anyCollapsed: keys.some((k) => isCollapsed(k)),
    touched: Object.keys(override).length > 0,
  };
}
