import { useEffect, useRef } from 'react';

export function useSwipeBack(onSwipeBack: () => void, threshold = 100) {
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      // Only register swipe from the left edge of the screen (<= 30px)
      if (e.touches[0].clientX <= 30) {
        touchStart.current = e.touches[0].clientX;
      } else {
        touchStart.current = null;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchStart.current === null) return;
      
      const touchEnd = e.changedTouches[0].clientX;
      if (touchEnd - touchStart.current > threshold) {
        onSwipeBack();
      }
      touchStart.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onSwipeBack, threshold]);
}
