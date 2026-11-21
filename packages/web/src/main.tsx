import { render } from 'preact';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/atkinson-hyperlegible-next/index.css';
import './styles.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
