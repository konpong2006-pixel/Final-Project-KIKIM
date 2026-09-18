import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {useFonts} from 'expo-font';
import {Prompt_400Regular, Prompt_500Medium, Prompt_600SemiBold, Prompt_700Bold, Prompt_800ExtraBold} from '@expo-google-fonts/prompt';
import {MaterialSymbols_400Regular} from '@expo-google-fonts/material-symbols';

import '@/global.css';
// Registers the Headless JS task the sleep widget's "เข้านอน"/"ตื่นนอน"
// buttons start; must run as soon as the bundle loads, not after mount, since
// Android can invoke it before any component ever renders.
import '@/tasks/sleep-widget-task';

import ToastHost from '@/components/app-toast';
import TourOverlay from '@/components/tour-overlay';
import { AuthProvider } from '@/providers/auth-provider';
import { InstitutionProvider } from '@/providers/institution-provider';
import { TourProvider } from '@/providers/tour-provider';
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
          <TourProvider>
            <ThemeProvider value={DefaultTheme}>
              <Stack screenOptions={{ animation: 'slide_from_right', headerShown: false }} />
              {/* Above the navigator so a toast is visible on whatever screen
                  raised it, and inside SafeAreaProvider so it clears the notch. */}
              <ToastHost />
              <TourOverlay />
              <StatusBar style="dark" />
            </ThemeProvider>
          </TourProvider>
        </InstitutionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
