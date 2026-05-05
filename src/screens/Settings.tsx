import { useState, useEffect } from 'react';
import { Moon, Sun, Palette, LogOut, Settings as SettingsIcon, Camera, Home, Image as ImageIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useThemeStore } from '../store';
import { auth, db, storage } from '../firebase';
import { signOut } from 'firebase/auth';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const THEME_COLORS = [
  { name: 'Blue', value: '221.2 83.2% 53.3%', class: 'bg-blue-500' },
  { name: 'Emerald', value: '160 84% 39%', class: 'bg-emerald-500' },
  { name: 'Violet', value: '262 83% 58%', class: 'bg-violet-500' },
  { name: 'Rose', value: '343 90% 60%', class: 'bg-rose-500' },
  { name: 'Amber', value: '43 96% 50%', class: 'bg-amber-500' },
  { name: 'Cyan', value: '189 94% 43%', class: 'bg-cyan-500' },
  { name: 'Fuchsia', value: '292 84% 61%', class: 'bg-fuchsia-500' },
  { name: 'Orange', value: '24 94% 50%', class: 'bg-orange-500' },
  { name: 'Lime', value: '84 81% 44%', class: 'bg-lime-500' },
  { name: 'Slate', value: '215 16% 47%', class: 'bg-slate-500' },
];

function hexToHSL(hex: string): string {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const cmin = Math.min(r,g,b), cmax = Math.max(r,g,b), delta = cmax - cmin;
  let h = 0, s = 0, l = 0;
  if (delta === 0) h = 0;
  else if (cmax === r) h = ((g - b) / delta) % 6;
  else if (cmax === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  l = (cmax + cmin) / 2;
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);
  return `${h} ${s}% ${l}%`;
}

export default function Settings() {
  const navigate = useNavigate();
  const { primaryColor, isDarkMode, setTheme, backgroundImage, backgroundStyle, backgroundOverlay, setAdvancedTheme } = useThemeStore();
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
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

  const handleAdvancedThemeUpdate = async (updates: any) => {
    setAdvancedTheme(updates);
    if (auth.currentUser) {
      try {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), updates);
      } catch (error) {
        console.error("Failed to save advanced theme preference:", error);
      }
    }
  };

  const handleBgImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !auth.currentUser) return;
    const file = e.target.files[0];
    
    setUploadingBg(true);
    try {
      const buffer = await file.arrayBuffer();
      const fileRef = ref(storage, `backgrounds/${auth.currentUser.uid}_${Date.now()}`);
      await uploadBytes(fileRef, buffer, { contentType: file.type });
      const url = await getDownloadURL(fileRef);
      
      await handleAdvancedThemeUpdate({ backgroundImage: url });
    } catch (error) {
      console.error("Failed to upload background:", error);
      alert('Failed to upload image.');
    } finally {
      setUploadingBg(false);
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
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
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
                <label className="w-10 h-10 rounded-full flex items-center justify-center bg-[conic-gradient(from_90deg,red,yellow,green,blue,magenta,red)] hover:scale-105 transition-transform cursor-pointer shadow-sm border-2 border-white dark:border-zinc-800">
                  <input 
                    type="color" 
                    className="opacity-0 absolute w-0 h-0"
                    onChange={(e) => handleThemeChange(hexToHSL(e.target.value), isDarkMode)}
                  />
                </label>
              </div>
            </div>

            {/* Background Image */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">Background</p>
                    <p className="text-sm text-zinc-500">Set a custom app background</p>
                  </div>
                </div>
                {backgroundImage && (
                  <button onClick={() => handleAdvancedThemeUpdate({ backgroundImage: null })} className="text-sm text-red-500 hover:text-red-600 font-medium bg-red-50 dark:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors">
                    Remove
                  </button>
                )}
              </div>

              {!backgroundImage ? (
                <label className="w-full py-4 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  {uploadingBg ? (
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Camera className="w-6 h-6 text-zinc-400 mb-2" />
                      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Upload Background</span>
                    </>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handleBgImageUpload} disabled={uploadingBg} />
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="relative h-32 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700">
                    <img src={backgroundImage} className="w-full h-full object-cover" />
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Display Style</p>
                      <div className="flex gap-2">
                        {(['stretch', 'contain', 'repeat'] as const).map(style => (
                          <button
                            key={style}
                            onClick={() => handleAdvancedThemeUpdate({ backgroundStyle: style })}
                            className={`flex-1 py-1.5 text-sm capitalize rounded-lg border font-medium transition-colors ${backgroundStyle === style ? 'bg-primary text-white border-primary' : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Dark/Light Overlay</p>
                        <span className="text-xs text-zinc-500">{backgroundOverlay ?? 50}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={backgroundOverlay ?? 50}
                        onChange={(e) => handleAdvancedThemeUpdate({ backgroundOverlay: parseInt(e.target.value) })}
                        className="w-full accent-primary"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </section>

      </main>
    </div>
  );
}
