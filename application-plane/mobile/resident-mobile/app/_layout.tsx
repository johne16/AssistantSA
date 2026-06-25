import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, LangProvider, shell_fonts } from '@/m-res-shell';

// Root layout for the resident mobile app. Composition root for the shell's
// concerns: it loads the brand fonts, holds the splash screen until they are
// ready, and wires the theme provider and the React Query client that later
// modules use for server state. It renders the navigation stack; the shell
// itself mounts on the index route. No auth and no backend calls happen here.

// Keep the native splash up while the brand fonts load.
SplashScreen.preventAutoHideAsync();

// One React Query client for the app's server-state needs. The shell makes no
// queries; this is the provider later modules read from.
const query_client = new QueryClient();

export default function RootLayout() {
  const [fonts_loaded, fonts_error] = useFonts(shell_fonts);

  useEffect(() => {
    if (fonts_loaded || fonts_error) {
      SplashScreen.hideAsync();
    }
  }, [fonts_loaded, fonts_error]);

  // Hold the splash until fonts resolve, so first paint uses the brand faces.
  if (!fonts_loaded && !fonts_error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={query_client}>
            <ThemeProvider>
              <LangProvider>
                <StatusBar style="auto" />
                <Stack screenOptions={{ headerShown: false }} />
              </LangProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
