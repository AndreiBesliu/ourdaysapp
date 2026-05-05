import { useState, useEffect } from 'react';
import { Moon, Sun, Palette, LogOut, Settings as SettingsIcon, Camera, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

const THEME_COLORS = [
  { name: 'Blue', value: '221.2 83.2% 53.3%', class: 'bg-blue-500' },
  { name: 'Emerald', value: '160 84% 39%', class: 'bg-emerald-500' },
  { name: 'Violet', value: '262 83% 58%', class: 'bg-violet-500' },
  { name: 'Rose', value: '343 90% 60%', class: 'bg-rose-500' },
  { name: 'Amber', value: '43 96% 50%', class: 'bg-amber-500' },
];

export default function Settings() {
  const navigate = useNavigate();
  const { primaryColor, isDarkMode, setTheme } = useThemeStore();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  useEffect(() => {
    if (!auth.currentUser) return;
    
    const unsub = onSnapshot(doc(db, 'users', auth.currentUser.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPhotoURL(data.photoURL || null);
      }
    });
    
    return () => unsub();
  }, []);

  const handleProfileImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !auth.currentUser) return;
    const file = e.target.files[0];
    
    setUploadingImage(true);
    try {
      const buffer = await file.arrayBuffer();
      const fileRef = ref(storage, `profiles/${auth.currentUser.uid}_${Date.now()}`);
      await uploadBytes(fileRef, buffer, { contentType: file.type });
      const url = await getDownloadURL(fileRef);
      
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        photoURL: url
      });
      setPhotoURL(url);
    } catch (error) {
      console.error("Failed to upload profile picture:", error);
      alert('Failed to upload image.');
    } finally {
      setUploadingImage(false);
    }
  };



  const handleThemeChange = async (newColor: string, newIsDark: boolean) => {
    setTheme(newColor, newIsDark);
    if (auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          primaryColor: newColor,
          isDarkMode: newIsDark
        });
      } catch (error) {
        console.error("Failed to save theme preference:", error);
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col transition-colors duration-200 pt-[60px]">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 flex items-center gap-3 fixed top-0 left-0 right-0 w-full z-[100] shadow-sm">
        <button onClick={() => navigate('/')} className="p-1.5 -ml-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
          <Home className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          <SettingsIcon className="w-6 h-6" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Settings</h1>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto p-4 flex flex-col gap-8 mt-4">
        
        {/* Account Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider pl-1">Account</h2>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-4 flex flex-col sm:flex-row items-center gap-4 border-b border-zinc-200 dark:border-zinc-800">
              
              <div className="relative group shrink-0">
                <div className="w-20 h-20 rounded-full bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden relative">
                  {uploadingImage ? (
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  ) : photoURL ? (
                    <img src={photoURL} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-zinc-400">{auth.currentUser?.email?.charAt(0).toUpperCase() || '?'}</span>
                  )}
                  <input 
                    type="file"
                    accept="image/*"
                    id="profile-upload"
                    className="hidden"
                    onChange={handleProfileImageUpload}
                  />
                  <label 
                    htmlFor="profile-upload"
                    className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity text-white"
                  >
                    <Camera className="w-6 h-6" />
                  </label>
                </div>
              </div>

              <div className="text-center sm:text-left">
                <p className="font-medium text-lg text-zinc-900 dark:text-zinc-100">{auth.currentUser?.displayName || 'My Profile'}</p>
                <p className="text-sm text-zinc-500">{auth.currentUser?.email}</p>
                <label htmlFor="profile-upload" className="text-xs font-medium text-primary cursor-pointer hover:underline sm:hidden mt-2 inline-block">
                  Change Photo
                </label>
              </div>

            </div>
            <button 
              onClick={handleSignOut}
              className="w-full p-4 flex items-center justify-between text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <span className="font-medium">Sign Out</span>
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </section>



        {/* Appearance Section */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider pl-1">Appearance</h2>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            
            {/* Dark Mode Toggle */}
            <div className="p-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300">
                  {isDarkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">Dark Mode</p>
                  <p className="text-sm text-zinc-500">Toggle dark theme</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={isDarkMode}
                  onChange={(e) => handleThemeChange(primaryColor, e.target.checked)}
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 dark:peer-focus:ring-primary/50 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Accent Color */}
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">Accent Color</p>
                  <p className="text-sm text-zinc-500">Choose your primary theme color</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                {THEME_COLORS.map(color => (
                  <button
                    key={color.name}
                    onClick={() => handleThemeChange(color.value, isDarkMode)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform ${color.class} ${primaryColor === color.value ? 'scale-110 ring-2 ring-offset-2 dark:ring-offset-zinc-900 ring-zinc-400' : 'hover:scale-105'}`}
                    title={color.name}
                  >
                    {primaryColor === color.value && <div className="w-2 h-2 bg-white rounded-full"></div>}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </section>

      </main>
    </div>
  );
}
