import {StyleSheet} from 'react-native';
import {WebView} from 'react-native-webview';

/**
 * Renders a generated HTML document (the printable receipt) inside the app.
 *
 * Native uses `react-native-webview`. The web build takes
 * `html-document-view.web.tsx` instead, because this component throws
 * "React Native WebView does not support this platform" in a browser -- which
 * is exactly what the "ดูใบเสร็จ" button did. Splitting by platform keeps the
 * native module out of the web bundle entirely rather than guarding it at
 * runtime.
 */
export default function HtmlDocumentView({html}: {html: string}) {
  return <WebView originWhitelist={['*']} source={{html}} style={styles.view} />;
}

const styles = StyleSheet.create({
  view: {backgroundColor: '#f1f4ed', flex: 1},
});
