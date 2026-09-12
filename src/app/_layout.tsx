import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {useFonts} from 'expo-font';
import {Prompt_400Regular, Prompt_500Medium, Prompt_600SemiBold, Prompt_700Bold, Prompt_800ExtraBold} from '@expo-google-fonts/prompt';
import {MaterialSymbols_400Regular} from '@expo-google-fonts/material-symbols';

import '@/global.css';

import ToastHost from '@/components/app-toast';
import { AuthProvider } from '@/providers/auth-provider';
import { InstitutionProvider } from '@/providers/institution-provider';
import {useDeadlineNotificationNavigation} from '@/services/deadline-notifications';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    MaterialSymbols_400Regular,
    Prompt_400Regular,
    Prompt_500Medium,
    Prompt_600SemiBold,
    Prompt_700Bold,
    Prompt_800ExtraBold,
  });
  useDeadlineNotificationNavigation();
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <InstitutionProvider>
          <ThemeProvider value={DefaultTheme}>
            <Stack screenOptions={{ headerShown: false }} />
            {/* Above the navigator so a toast is visible on whatever screen
                raised it, and inside SafeAreaProvider so it clears the notch. */}
            <ToastHost />
            <StatusBar style="dark" />
          </ThemeProvider>
        </InstitutionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
