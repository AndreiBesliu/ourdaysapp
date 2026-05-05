import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

// Components
import Login from './screens/Login';
import CalendarHome from './screens/CalendarHome';
import Wallet from './screens/Wallet';
import Settings from './screens/Settings';
import { useThemeStore } from './store';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme, isDarkMode, primaryColor } = useThemeStore();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    document.documentElement.style.setProperty('--primary', primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const userDocRef = doc(db, 'users', currentUser.uid);
          
          // Fetch existing user data to apply preferences
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            if (data.primaryColor || data.isDarkMode !== undefined) {
              setTheme(
                data.primaryColor || '221.2 83.2% 53.3%',
                data.isDarkMode === true
              );
            }
          }

          // Save user to DB if not exists
          await setDoc(userDocRef, {
            email: currentUser.email,
            lastLogin: new Date().toISOString(),
          }, { merge: true });
          
          // If the document was just created, it won't have familyMembers, 
          // but we can initialize it if it's completely missing
          if (!userDocSnap.exists() || !userDocSnap.data()?.familyMembers) {
            await updateDoc(userDocRef, { familyMembers: [] }).catch(() => {});
          }
        } catch (error) {
          console.error("Failed to update user doc:", error);
        }
        
        setUser(currentUser);

        // Initialize Push Notifications if running natively
        if (Capacitor.isNativePlatform()) {
          try {
            const permStatus = await PushNotifications.requestPermissions();
            if (permStatus.receive === 'granted') {
              await PushNotifications.register();
              
              PushNotifications.addListener('registration', async (token) => {
                await updateDoc(doc(db, 'users', currentUser.uid), {
                  fcmToken: token.value
                });
              });

              PushNotifications.addListener('pushNotificationReceived', (notification) => {
                console.log('Push received: ', notification);
              });
            }
          } catch (e) {
            console.error("Push notification setup failed:", e);
          }
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/login" 
          element={!user ? <Login /> : <Navigate to="/" />} 
        />
        <Route 
          path="/" 
          element={user ? <CalendarHome /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/wallet" 
          element={user ? <Wallet /> : <Navigate to="/login" />} 
        />

        <Route 
          path="/settings" 
          element={user ? <Settings /> : <Navigate to="/login" />} 
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
