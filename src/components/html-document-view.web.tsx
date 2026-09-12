import {createElement} from 'react';

/**
 * The web half of {@link ../html-document-view}.
 *
 * `react-native-webview` is native-only, so on the web the same generated HTML
 * goes into a sandboxed iframe. `srcDoc` renders the markup directly without
 * needing a URL, and the sandbox keeps a generated document from navigating
 * the app or reaching app storage -- it only has to display a receipt.
 *
 * `createElement` is used rather than JSX because `iframe` is a DOM element,
 * not a React Native component: react-native-web passes it through to the DOM,
 * but the JSX namespace in this project types React Native elements.
 */
export default function HtmlDocumentView({html}: {html: string}) {
  return createElement('iframe', {
    sandbox: '',
    srcDoc: html,
    style: {
      backgroundColor: '#f1f4ed',
      border: 'none',
      flexGrow: 1,
      height: '100%',
      width: '100%',
    },
    title: 'ใบเสร็จ',
  });
}
