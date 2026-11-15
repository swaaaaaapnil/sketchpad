import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import Editor from './components/Editor.jsx';

const THEME_KEY = 'sketchpad.theme';

function parseHash() {
  const m = window.location.hash.match(/^#\/b\/([\w-]+)/);
  return m ? { name: 'board', id: m[1] } : { name: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) return saved === 'dark';
    } catch {
      /* storage blocked */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      /* storage blocked */
    }
  }, [dark]);

  useEffect(() => {
    document.title = route.name === 'board' ? 'Sketch · Sketchpad' : 'Sketchpad — hand-drawn whiteboard';
  }, [route]);

  if (route.name === 'board') {
    return <Editor key={route.id} boardId={route.id} dark={dark} setDark={setDark} onHome={() => (window.location.hash = '#/')} />;
  }
  return <Home dark={dark} setDark={setDark} onOpen={(id) => (window.location.hash = `#/b/${id}`)} />;
}
