import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from '../lib/store.js';

// Google's own "Sign in with Google" button. Falls back to our redirect button
// when Google's script can't load or no client id is configured.
export default function GoogleButton({ before, onFallback, onError, onDone, dark, text = 'signin_with', fallbackClass = 'primary-btn' }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    renderGoogleButton(ref.current, { before, onDone, onError, theme: dark ? 'filled_black' : 'outline', text })
      .then((ok) => live && !ok && setFailed(true))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, text]);
  if (failed) return <button className={fallbackClass} onClick={onFallback}>Sign in with Google</button>;
  return <div ref={ref} className="gsi-btn" />;
}
