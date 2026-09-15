import {useEffect, useState} from 'react';
import {AppState, Platform} from 'react-native';

export function useCurrentClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') update(); });
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.removeEventListener('focus', update);
    };
  }, []);
  return now;
}
