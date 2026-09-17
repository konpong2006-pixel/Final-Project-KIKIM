import {useCallback, useEffect, useRef} from 'react';
import type {View} from 'react-native';

import type {TourTabKey} from '@/config/tour-steps';
import {useTour} from '@/providers/tour-provider';

type ScrollableNode = View & {scrollIntoView?: (options?: {block?: string; behavior?: string}) => void};

/**
 * Attach the returned `ref` + `onLayout` to whatever real button a tour step
 * should spotlight. It only measures while that exact step is the active
 * one, so screens pay nothing for this outside of a running tour.
 */
export function useTourTarget(tabKey: TourTabKey, stepId: string) {
  const {activeTab, activeStepId, registerTarget} = useTour();
  const ref = useRef<View>(null);
  const active = activeTab === tabKey && activeStepId === stepId;

  const measure = useCallback(() => {
    if (!active) return;
    const node = ref.current as ScrollableNode | null;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      // A target further down a scrolling screen (e.g. dashboard's weekly
      // spending card) can lay out below the fold, which would spotlight an
      // invisible rect. `scrollIntoView` only exists on react-native-web's
      // DOM nodes, so this is a no-op on native and simply skips the target
      // there instead of crashing.
      const viewportHeight = typeof window === 'undefined' ? Infinity : window.innerHeight;
      const offscreen = y < 0 || y + height > viewportHeight;
      if (offscreen && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({block: 'center', behavior: 'instant'});
        requestAnimationFrame(() => {
          node.measureInWindow((x2, y2, width2, height2) => {
            if (width2 > 0 && height2 > 0) registerTarget(tabKey, stepId, {x: x2, y: y2, width: width2, height: height2});
          });
        });
        return;
      }
      registerTarget(tabKey, stepId, {x, y, width, height});
    });
  }, [active, tabKey, stepId, registerTarget]);

  useEffect(() => {
    if (!active) return;
    // The button may already have laid out before this step became active,
    // so measure once on activation instead of waiting for the next onLayout.
    // A 120 ms delay lets any scroll-to-top called at tour-start settle before
    // measureInWindow runs, so the coordinates reflect the element's true
    // on-screen position rather than an offset shifted by the scroll position.
    const timer = setTimeout(measure, 120);
    return () => clearTimeout(timer);
  }, [active, measure]);

  return {ref, onLayout: measure};
}
