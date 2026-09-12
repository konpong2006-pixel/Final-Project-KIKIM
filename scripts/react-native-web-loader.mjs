// Maps `react-native` to `react-native-web` for the render check, which is the
// same substitution the web bundle makes.
const stubs = new Map([['react-native', 'react-native-web']]);

export async function resolve(specifier, context, nextResolve) {
  const target = stubs.get(specifier);
  return nextResolve(target ?? specifier, context);
}
