import { Component, useEffect, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import {
  ThemeProvider,
  LangProvider,
  shell_fonts,
  query_client,
  persist_options,
  setup_query_managers,
} from '@/m-res-shell';

// Root layout for the resident mobile app. Composition root for the shell's
// concerns: it loads the brand fonts, holds the splash screen until they are
// ready, and wires the theme provider and the persisted React Query client that
// the data modules read from. It renders the navigation stack; the shell itself
// mounts on the index route. No auth and no backend calls happen here.

// Keep the native splash up while the brand fonts load.
SplashScreen.preventAutoHideAsync();

// Wire NetInfo -> onlineManager and AppState -> focusManager before mount.
setup_query_managers();

// Top-level error boundary: a render-time throw degrades to a retry screen.
// Neutral styling so it renders even if a theme-dependent subtree threw.
class ErrorBoundary extends Component<
  { children: ReactNode },
  { has_error: boolean }
> {
  state = { has_error: false };

  static getDerivedStateFromError(): { has_error: boolean } {
    return { has_error: true };
  }

  render() {
    if (!this.state.has_error) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: '#faf7f2',
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '600', color: '#1a1a1a' }}>
          Something went wrong
        </Text>
        <Pressable
          onPress={() => this.setState({ has_error: false })}
          style={{
            marginTop: 16,
            paddingVertical: 12,
            paddingHorizontal: 24,
            borderRadius: 12,
            backgroundColor: '#1a1a1a',
          }}
        >
          <Text style={{ color: '#faf7f2', fontSize: 15, fontWeight: '600' }}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }
}

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
          <PersistQueryClientProvider
            client={query_client}
            persistOptions={persist_options}
          >
            <ThemeProvider>
              <LangProvider>
                <StatusBar style="auto" />
                {/* Hide the Android system navigation bar so it does not cover
                    the bottom of the app; a swipe from the edge reveals it
                    transiently. autoHideHomeIndicator is the iOS equivalent. */}
                <NavigationBar hidden />
                <ErrorBoundary>
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      autoHideHomeIndicator: true,
                    }}
                  />
                </ErrorBoundary>
              </LangProvider>
            </ThemeProvider>
          </PersistQueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
